import "server-only";

import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

import { getMcpConfig, type McpConfig } from "@/lib/config";
import { createBearerClient } from "@/lib/supabase/bearer";

type ActorProfile = Readonly<{
  userId: string;
  organizationId: string;
  role: "admin" | "operator" | "viewer";
  fullName: string;
}>;

type VerifiedClaims = JWTPayload & Readonly<{
  client_id?: unknown;
  email?: unknown;
  role?: unknown;
  scope?: unknown;
}>;

export type McpAuthExtra = Readonly<{
  subject: string;
  email?: string;
  actor: ActorProfile;
}>;

type JwtVerifier = (token: string) => Promise<VerifiedClaims>;
type PrincipalLoader = (token: string, subject: string) => Promise<ActorProfile>;

function requiredString(value: unknown, claim: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new OAuthError(OAuthErrorCode.InvalidToken, `Access token is missing ${claim}`);
  }
  return value;
}

function scopesFromClaim(value: unknown) {
  if (typeof value !== "string") return [];
  return [...new Set(value.split(/\s+/).filter(Boolean))];
}

export class OpenFinanceTokenVerifier implements OAuthTokenVerifier {
  constructor(
    private readonly config: McpConfig,
    private readonly verifyJwt: JwtVerifier,
    private readonly loadPrincipal: PrincipalLoader,
  ) {}

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    try {
      const claims = await this.verifyJwt(token);
      const subject = requiredString(claims.sub, "subject");
      const clientId = requiredString(claims.client_id, "OAuth client ID");
      const expiresAt = typeof claims.exp === "number" ? claims.exp : undefined;
      if (!expiresAt) throw new OAuthError(OAuthErrorCode.InvalidToken, "Access token is missing expiry");
      if (claims.role !== "authenticated") {
        throw new OAuthError(OAuthErrorCode.InvalidToken, "Access token has an invalid role");
      }

      const actor = await this.loadPrincipal(token, subject);
      return {
        token,
        clientId,
        scopes: scopesFromClaim(claims.scope),
        expiresAt,
        resource: this.config.resourceUrl,
        extra: {
          subject,
          ...(typeof claims.email === "string" ? { email: claims.email } : {}),
          actor,
        } satisfies McpAuthExtra,
      };
    } catch (error) {
      if (error instanceof OAuthError) throw error;
      throw new OAuthError(OAuthErrorCode.InvalidToken, "Access token is invalid or expired");
    }
  }
}

function productionJwtVerifier(config: McpConfig): JwtVerifier {
  const jwks = createRemoteJWKSet(config.jwksUrl, {
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60_000,
    timeoutDuration: 5_000,
  });

  return async (token) => {
    const { payload } = await jwtVerify(token, jwks, {
      algorithms: ["ES256"],
      audience: config.resourceUrl.href,
      issuer: config.authorizationServerUrl.href.replace(/\/$/, ""),
      requiredClaims: ["sub", "exp", "iat", "client_id"],
    });
    return payload as VerifiedClaims;
  };
}

const productionPrincipalLoader: PrincipalLoader = async (token, subject) => {
  const supabase = createBearerClient(token);
  const [{ data: userData, error: userError }, { data: profileData, error: profileError }] = await Promise.all([
    supabase.auth.getUser(token),
    supabase
      .from("profiles")
      .select("user_id, organization_id, role, full_name")
      .eq("user_id", subject)
      .single(),
  ]);

  if (userError || userData.user?.id !== subject || profileError || !profileData) {
    throw new OAuthError(OAuthErrorCode.InvalidToken, "Access token is not authorized for an AR workspace");
  }

  const role = profileData.role;
  if (role !== "admin" && role !== "operator" && role !== "viewer") {
    throw new OAuthError(OAuthErrorCode.InvalidToken, "Access token has an invalid workspace role");
  }

  return {
    userId: profileData.user_id,
    organizationId: profileData.organization_id,
    role,
    fullName: profileData.full_name,
  };
};

let productionVerifier: OpenFinanceTokenVerifier | undefined;

export function getOpenFinanceTokenVerifier() {
  const config = getMcpConfig();
  productionVerifier ??= new OpenFinanceTokenVerifier(
    config,
    productionJwtVerifier(config),
    productionPrincipalLoader,
  );
  return productionVerifier;
}
