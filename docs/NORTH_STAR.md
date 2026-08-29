# OpenFinance: challenge north star

Updated: 2026-08-28

## The thesis

OpenFinance demonstrates a new form of B2B interoperability: a human and browser agent complete a financial workflow across two independently authenticated web applications, using structured capabilities exposed by each application rather than a point-to-point integration.

The first workflow is invoice delivery from a seller's AR application to a customer's AP portal. The larger commercial opportunity extends to status retrieval, rejection handling, disputes, remittance, expected payment dates, and collections intelligence.

## What the challenge is actually rewarding

The official challenge asks for an application that becomes meaningfully better when people and their agents use it together. The Devpost rubric evaluates:

| Criterion | Proof OpenFinance must show |
| --- | --- |
| WebMCP leverage | The agent discovers and uses several non-trivial read and write tools from two independent origins. The workflow would be materially less reliable using UI guessing alone. |
| Execution | The product is polished, coherent, authenticated, recoverable, and visibly updates real application state. |
| Potential impact | Supplier AR teams currently re-enter financial data into customer AP portals and lose visibility after submission. The demo must solve that exact pain. |
| Creativity and ambition | The browser agent becomes a user-controlled interoperability layer between applications that have no connector or credential-sharing relationship. |

The OpenAI challenge page additionally emphasizes usefulness, originality, thoughtful WebMCP use, and the quality of the human-agent experience.

## The human-agent contract

This is collaboration, not invisible automation.

| Human | Agent | Applications |
| --- | --- | --- |
| States the business intent | Discovers available tools and relevant page state | Authenticate and authorize their own users |
| Reviews and approves the exact cross-site transfer scope | Collects candidate invoice packages without transferring them | Enforce business rules server-side |
| Resolves ambiguity and exercises judgment | Explains why each invoice is ready or blocked | Expose narrow structured capabilities |
| Separately confirms consequential submissions | Validates and executes only the corresponding approved sets | Update visible state and retain audit history |
| Can inspect and correct the result | Returns references, status, and recovery guidance | Remain usable through their normal human UI |

The agent should save effort and handle cross-system complexity. The human should retain authority and understand what will happen before it happens.

## Why WebMCP is essential

WebMCP lets a document register JavaScript-based tools with names, descriptions, JSON Schema inputs, execution callbacks, and annotations. Tools are associated with the providing document and origin. The browser can expose those tools to its agent alongside relevant page observations.

This is a better fit than raw browser actuation because financial workflows require reliable semantics: an agent should call an explicit invoice-validation operation rather than infer the meaning of buttons and fields. WebMCP is primarily designed for local browser workflows with a human in the loop, which aligns directly with this product.

The two applications do not share authentication. Site tools operate in each page's current signed-in session, and tools remain scoped to the page that provides them. That is a product advantage: OpenFinance does not need to receive or retain the customer's AP portal credentials.

## Tool-quality standard

Chrome's current guidance becomes our engineering standard:

- Start with a tool strategy and avoid overlapping purposes.
- Use clear, precise, positive descriptions and verb-based names.
- Keep tool and parameter context small enough for reliable selection.
- Minimize transformations the model must perform.
- Validate strict business logic in code and return descriptive errors.
- Update the visible interface after execution.
- Mark read-only and untrusted-content behavior with annotations.
- Test natural-language selection and complete workflows, not only isolated callbacks.
- Expect the draft standard and browser implementations to evolve.

For this financial workflow, all write tools should be idempotent or safely reject duplicates. Read tools must enforce tenant or supplier scope even if their inputs contain another tenant's identifiers.

## The three-minute story

**0:00-0:20 — Pain**

An AR user has several invoices ready for a customer's portal. Normally, the user must copy data, upload documents, check PO rules, and later re-enter the portal result.

**0:20-0:35 — Architectural reveal**

OpenFinance AR and the customer's AP portal are independent, separately authenticated applications. There is no connector and neither application knows the other's schema.

**0:35-0:58 — Discovery and transfer approval**

The user gives one intent. The agent reads the ready invoices from OpenFinance, excludes the missing-PO invoice, and shows the exact candidate invoices and AP destination. The human approves only those packages for read-only validation.

**0:58-1:25 — Discovery and reasoning**

The agent discovers the AP portal's requirements, looks up POs, and validates only the transfer-approved packages. One candidate exceeds the remaining balance.

**1:25-1:45 — Submission control**

The agent shows the exact valid invoices, amounts, POs, total, destination, and exceptions. The human separately approves only the valid batch for submission.

**1:45-2:20 — Execution**

The agent submits the invoices through the AP portal's tools, receives reference numbers, and records the outcome back in OpenFinance.

**2:20-2:40 — Visible proof**

Both sites show the updated records and audit trail. The agent summarizes what succeeded, what was blocked, and the next action.

**2:40-2:58 — Implication**

This is the WebMCP-native future of OpenFinance Network. Legacy portals can later be reached through APIs or learned browser skills, while the product retains the same normalized business workflow.

## Feature filter

Before adding a feature, answer:

1. Does it make the human-agent collaboration more legible or useful?
2. Does it demonstrate a meaningful WebMCP capability?
3. Does it strengthen the real AR-team problem being solved?
4. Will it be visible or explainable inside the three-minute demo?
5. Can we implement and test it without making the core path less reliable?

If the answer is no to most of these, it is outside challenge scope.

## Submission checklist

- Live URL works in ChatGPT's in-app browser.
- Demo credentials are tested and provided only through the submission platform's private credentials field.
- Both applications are independently authenticated and authorized.
- Repository is public and includes a visible open-source license.
- README includes architecture, setup, tool inventory, security model, and exact demo prompt.
- All source code and assets required to reproduce the project are included.
- Demo video is public, has audio, and is under three minutes.
- Description explains WebMCP fit, better UX, previously difficult human-agent capability, and implementation.
- Tool schemas and actual code demonstrate non-trivial effort.
- The full workflow has been tested repeatedly from a clean seeded state.
- Submission facts and rules are rechecked on Devpost immediately before submission because the rules may change.

## Primary sources

- [OpenAI WebMCP Challenge](https://openai.com/webmcp-challenge/)
- [Official Devpost challenge page and judging rubric](https://webmcp.devpost.com/)
- [Official challenge rules](https://webmcp.devpost.com/rules)
- [WebMCP draft specification](https://webmachinelearning.github.io/webmcp/)
- [Chrome WebMCP guide](https://developer.chrome.com/docs/ai/webmcp)
- [Chrome WebMCP best practices](https://developer.chrome.com/docs/ai/webmcp/best-practices)
- [Chrome WebMCP tool security](https://developer.chrome.com/docs/ai/webmcp/secure-tools)
- [OpenAI site-tools guidance](https://help.openai.com/en/articles/20001423-using-site-tools-in-the-chatgpt-desktop-app)
