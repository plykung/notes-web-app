// Spike: prove we can read, create, edit and delete Sticky Notes through the
// Graph mail API on the Notes folder (see docs/adr/0001). /me/notes returns 403
// for this account, so it is no longer probed.
import { PublicClientApplication, type AccountInfo } from "@azure/msal-browser";

const SCOPES = ["User.Read", "Mail.ReadWrite"];
const GRAPH = "https://graph.microsoft.com/v1.0";
const NOTES = `${GRAPH}/me/mailFolders/notes/messages`;
const TEST_NOTE_KEY = "spikeTestNoteId";

// The exact wrapper the native Sticky Notes app writes, so our notes look native.
const NOTE_HEAD =
  '<html><head>\r\n<meta http-equiv="Content-Type" content="text/html; charset=utf-8"><style>\r\n<!--\r\n' +
  "ul\r\n\t{list-style:none}\r\nhtml, body, div, span, h1, h2, h3, h4, h5, h6, p, ul, li\r\n" +
  "\t{margin:0;\r\n\tpadding:0;\r\n\tborder:0;\r\n\toutline:0;\r\n\tfont-size:100%;\r\n\tvertical-align:baseline}\r\n" +
  '-->\r\n</style></head><body id="NotesClientContent"><div>';
const NOTE_TAIL = "</div></body></html>";

type Message = {
  id: string;
  "@odata.etag": string;
  subject: string;
  isDraft: boolean;
  lastModifiedDateTime: string;
  body: { contentType: string; content: string };
};

const statusEl = document.getElementById("status")!;
const notesEl = document.getElementById("notes")!;
const signinBtn = document.getElementById("signin") as HTMLButtonElement;

const clientId = import.meta.env.VITE_ENTRA_CLIENT_ID;
if (!clientId) {
  statusEl.textContent = "Missing VITE_ENTRA_CLIENT_ID in .env";
  throw new Error("Missing client id");
}

const msal = new PublicClientApplication({
  auth: {
    clientId,
    authority: "https://login.microsoftonline.com/consumers",
    redirectUri: window.location.origin,
  },
  cache: { cacheLocation: "localStorage" },
});

let account: AccountInfo;

async function getToken(): Promise<string> {
  try {
    return (await msal.acquireTokenSilent({ scopes: SCOPES, account })).accessToken;
  } catch {
    await msal.acquireTokenRedirect({ scopes: SCOPES, account });
    throw new Error("Redirecting for consent");
  }
}

async function graph(method: string, url: string, body?: unknown, etag?: string) {
  const headers: Record<string, string> = { Authorization: `Bearer ${await getToken()}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (etag) headers["If-Match"] = etag;
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { ok: res.ok, status: res.status, json: text ? JSON.parse(text) : null };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function noteHtml(lines: string[]): string {
  return NOTE_HEAD + lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("") + NOTE_TAIL;
}

function log(title: string, detail: unknown) {
  const pre = document.createElement("pre");
  pre.textContent = `${new Date().toLocaleTimeString()} ${title}\n${
    typeof detail === "string" ? detail : JSON.stringify(detail, null, 2)
  }`;
  notesEl.prepend(pre);
}

const SELECT = "$select=subject,body,isDraft,lastModifiedDateTime";

async function readNewest() {
  const r = await graph("GET", `${NOTES}?$top=1&$orderby=lastModifiedDateTime desc&${SELECT}`);
  const note: Message | undefined = r.json?.value?.[0];
  log(`${r.status} newest note`, note ?? r.json);
  return note;
}

// The real edit test: a note the native app created, which is not a draft.
async function editNewest() {
  const note = await readNewest();
  if (!note) return;
  const content = note.body.content.replace(NOTE_TAIL, `<p>✏️ edited by spike</p>${NOTE_TAIL}`);
  const r = await graph("PATCH", `${GRAPH}/me/messages/${note.id}`, { body: { contentType: "html", content } }, note["@odata.etag"]);
  log(`${r.status} edit newest note via body (isDraft was ${note.isDraft})`, r.ok ? "OK" : r.json);
}

async function createTest() {
  const r = await graph("POST", NOTES, {
    subject: "🧪 spike test",
    body: { contentType: "html", content: noteHtml(["🧪 spike test", "", "created by the spike"]) },
    singleValueExtendedProperties: [{ id: "String 0x001A", value: "IPM.StickyNote" }],
  });
  if (r.ok) localStorage.setItem(TEST_NOTE_KEY, r.json.id);
  log(`${r.status} create test note`, r.ok ? { id: r.json.id, isDraft: r.json.isDraft } : r.json);
}

async function editTest() {
  const id = localStorage.getItem(TEST_NOTE_KEY);
  if (!id) return log("edit test note", "No test note yet. Create one first.");
  const current = await graph("GET", `${GRAPH}/me/messages/${id}?${SELECT}`);
  if (!current.ok) return log(`${current.status} read test note`, current.json);
  const r = await graph(
    "PATCH",
    `${GRAPH}/me/messages/${id}`,
    { body: { contentType: "html", content: noteHtml(["🧪 spike test", "", "edited by the spike ✅"]) } },
    current.json["@odata.etag"],
  );
  log(`${r.status} edit test note (isDraft ${current.json.isDraft})`, r.ok ? "OK" : r.json);
}

async function deleteTest() {
  const id = localStorage.getItem(TEST_NOTE_KEY);
  if (!id) return log("delete test note", "No test note to delete.");
  const r = await graph("DELETE", `${GRAPH}/me/messages/${id}`);
  if (r.ok) localStorage.removeItem(TEST_NOTE_KEY);
  log(`${r.status} delete test note`, r.ok ? "OK (moved to Deleted Items)" : r.json);
}

// Where do note images live? Reports structure only, never note text.
async function inspectImages() {
  const all: { id: string; hasAttachments: boolean; body: { content: string } }[] = [];
  for (let url: string | undefined = `${NOTES}?$top=100&$orderby=lastModifiedDateTime desc&$select=hasAttachments,body`; url; ) {
    const r = await graph("GET", url);
    if (!r.ok) return log(`${r.status} list notes`, r.json);
    all.push(...r.json.value);
    url = r.json["@odata.nextLink"];
  }
  const withAttachments = all.filter((n) => n.hasAttachments);
  const withImgTags = all.filter((n) => /<img/i.test(n.body.content));
  const report: Record<string, unknown> = {
    notes: all.length,
    hasAttachmentsTrue: withAttachments.length,
    bodyHasImgTag: withImgTags.length,
  };

  // Image sources reduced to their scheme and host, so no content is shown.
  report.imgSources = withImgTags.slice(0, 3).map((n) => ({
    id: n.id.slice(-12),
    srcs: [...n.body.content.matchAll(/<img[^>]*\ssrc="([^"]*)"/gi)].map(([, src]) =>
      src.startsWith("data:") ? `data:${src.slice(5, src.indexOf(";"))} (${src.length} chars)` : src.replace(/^(\w+:\/*[^/]*).*/, "$1/…"),
    ),
    imgTag: n.body.content.match(/<img[^>]*>/i)?.[0].replace(/src="[^"]{40,}"/, 'src="…"').slice(0, 300),
  }));

  report.attachments = [];
  // Newest first, every field except the image bytes, to compare native and uploaded images.
  for (const n of [...withAttachments, ...withImgTags].slice(0, 3)) {
    const r = await graph("GET", `${GRAPH}/me/messages/${n.id}/attachments`);
    const value = (r.json?.value ?? []).map(({ contentBytes, id, ...rest }: Record<string, unknown>) => ({
      ...rest,
      id: String(id).slice(-16),
      bytes: typeof contentBytes === "string" ? contentBytes.length : null,
    }));
    (report.attachments as unknown[]).push({ id: n.id.slice(-12), status: r.status, value });
  }
  log("image inspection", report);
}

// Which blank-line and space encodings survive in the PC app and onenote.com?
async function blankLineTest() {
  const lines = [
    "<p>🧪 blank line test</p>",
    "<p>A: empty paragraph below</p><p></p>",
    "<p>B: paragraph with a line break below</p><p><br></p>",
    "<p>C: paragraph with a non-breaking space below</p><p>&nbsp;</p>",
    "<p>D: two spaces [a  b], kept spaces [a&nbsp;&nbsp;b]</p>",
    "<p>end</p>",
  ];
  const r = await graph("POST", NOTES, {
    subject: "🧪 blank line test",
    body: { contentType: "html", content: NOTE_HEAD + lines.join("") + NOTE_TAIL },
    singleValueExtendedProperties: [{ id: "String 0x001A", value: "IPM.StickyNote" }],
  });
  if (r.ok) localStorage.setItem(TEST_NOTE_KEY, r.json.id);
  log(
    `${r.status} blank line test note`,
    r.ok ? "Created. Check it in the PC app and onenote.com: under which of A, B, C is there a blank line? Does D show 2 spaces in both? Delete it with button 5." : r.json,
  );
}

// Round 2: A–C all lost their blank line, and &nbsp; vanished. These avoid
// empty or whitespace-only lines, which seem to be dropped when Microsoft
// converts the note.
async function blankLineTest2() {
  const ZWSP = "​"; // zero-width space: invisible, but the line isn't empty
  const html = [
    "<p>🧪 blank line test 2</p>",
    "<p>E: two line breaks inside one paragraph<br><br>after E</p>",
    "<p>F: above a div with a line break</p><div><br></div><p>F below</p>",
    `<p>G: above a line holding a zero-width space</p><p>${ZWSP}</p><p>G below</p>`,
    `<p>H: spaces with a zero-width space between [a ${ZWSP} b]</p>`,
    "<p>I: two en spaces [a  b]</p>",
  ].join("");
  const created: string[] = [];
  for (const [subject, body] of [
    ["🧪 blank line test 2", { contentType: "html", content: NOTE_HEAD + html + NOTE_TAIL }],
    // J: the same idea written as plain text instead of HTML.
    ["🧪 blank line test 3 (plain text)", { contentType: "text", content: "🧪 blank line test 3 (plain text)\r\nJ: blank line below\r\n\r\nJ below\r\nK: two spaces [a  b]" }],
  ] as const) {
    const r = await graph("POST", NOTES, {
      subject,
      body,
      singleValueExtendedProperties: [{ id: "String 0x001A", value: "IPM.StickyNote" }],
    });
    if (!r.ok) return log(`${r.status} ${subject}`, r.json);
    created.push(subject);
  }
  log(
    "blank line test notes",
    `Created: ${created.join(", ")}.\nIn the PC app and onenote.com: which of E, F, G and J have a blank line? Do H, I and K show 2 spaces? Delete both test notes yourself afterwards.`,
  );
}

function addButton(label: string, action: () => Promise<unknown>) {
  const btn = document.createElement("button");
  btn.textContent = label;
  btn.onclick = () => action().catch((e) => log("ERROR", String(e)));
  statusEl.after(btn);
}

async function start() {
  await msal.initialize();
  const redirect = await msal.handleRedirectPromise();
  const found = redirect?.account ?? msal.getAllAccounts()[0];

  signinBtn.onclick = () => msal.loginRedirect({ scopes: SCOPES });
  if (!found) return;
  account = found;
  signinBtn.hidden = true;
  await getToken();
  statusEl.textContent = `Signed in as ${account.username}.`;

  // after() inserts right after the status line, so add in reverse order.
  addButton("8. Blank line test 2", blankLineTest2);
  addButton("7. Blank line test note", blankLineTest);
  addButton("6. Inspect images", inspectImages);
  addButton("5. Delete test note", deleteTest);
  addButton("4. Edit test note", editTest);
  addButton("3. Create test note", createTest);
  addButton("2. Edit newest note", editNewest);
  addButton("1. Read newest note", readNewest);
}

start().catch((err) => {
  statusEl.textContent = `Error: ${err.message}`;
  console.error(err);
});
