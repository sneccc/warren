/**
 * The single chat page, served as a string. It renders every piece of
 * model text with textContent (never innerHTML), so model output cannot
 * inject markup. The page script avoids backticks and dollar-brace so it
 * can live inside this template literal.
 */
export const CHAT_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Warren Orchestrator</title>
<style>
:root { --bg:#fafaf8; --fg:#1d1d1b; --muted:#6b6b66; --card:#ffffff; --line:#dcdcd6; --accent:#1f6feb; --ok:#1a7f37; --bad:#b42318; --code:#f0f0ec; }
@media (prefers-color-scheme: dark) { :root { --bg:#14151a; --fg:#e8e8e3; --muted:#9a9a94; --card:#1d1f26; --line:#33363f; --accent:#6ea8fe; --ok:#56d364; --bad:#ff7b72; --code:#262932; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.5 system-ui, sans-serif; display:flex; flex-direction:column; height:100vh; }
header { display:flex; gap:12px; align-items:center; padding:10px 16px; border-bottom:1px solid var(--line); }
header h1 { font-size:16px; margin:0; flex:1; }
header .meta { color:var(--muted); font-size:13px; }
main { flex:1; display:flex; min-height:0; }
#log { flex:1; overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:12px; }
aside { width:340px; border-left:1px solid var(--line); padding:12px 16px; overflow-y:auto; font-size:12px; color:var(--muted); }
aside pre { white-space:pre-wrap; word-break:break-word; margin:0; }
.msg { max-width:820px; padding:10px 14px; border-radius:10px; border:1px solid var(--line); background:var(--card); }
.msg.user { align-self:flex-end; background:var(--accent); color:#fff; border-color:var(--accent); }
.msg .text { white-space:pre-wrap; word-break:break-word; }
.msg pre { background:var(--code); padding:8px 10px; border-radius:6px; overflow-x:auto; margin:6px 0; white-space:pre; }
.note { color:var(--muted); font-size:12px; margin-top:4px; }
.card { max-width:820px; border:1px solid var(--accent); border-radius:10px; padding:12px 14px; background:var(--card); }
.card h3 { margin:0 0 4px; font-size:14px; }
.card .kind { color:var(--accent); font-size:12px; text-transform:uppercase; letter-spacing:.04em; }
.card pre { background:var(--code); padding:8px 10px; border-radius:6px; white-space:pre-wrap; word-break:break-word; max-height:220px; overflow:auto; margin:8px 0; }
.card.bad { border-color:var(--bad); }
.actions { display:flex; gap:8px; }
button { font:inherit; padding:6px 14px; border-radius:6px; border:1px solid var(--line); background:var(--card); color:var(--fg); cursor:pointer; }
button.primary { background:var(--ok); border-color:var(--ok); color:#fff; }
button:disabled { opacity:.5; cursor:default; }
form { display:flex; gap:8px; padding:12px 16px; border-top:1px solid var(--line); }
textarea { flex:1; font:inherit; padding:8px 10px; border-radius:8px; border:1px solid var(--line); background:var(--card); color:var(--fg); resize:vertical; min-height:44px; max-height:200px; }
@media (max-width: 800px) { aside { display:none; } }
</style>
</head>
<body>
<header><h1>Warren Orchestrator</h1><span class="meta" id="meta"></span><button id="newchat" type="button">New chat</button></header>
<main>
<div id="log"></div>
<aside><strong>Live Warren state</strong><pre id="snap">loading...</pre></aside>
</main>
<form id="form"><textarea id="input" placeholder="Talk to the orchestrator. Enter sends. Shift+Enter makes a new line." autofocus></textarea><button class="primary" id="send" type="submit">Send</button></form>
<script>
(function () {
  var FENCE = "\\u0060\\u0060\\u0060";
  var log = document.getElementById("log");
  var input = document.getElementById("input");
  var sendBtn = document.getElementById("send");
  var sessionId = null;
  try { sessionId = localStorage.getItem("orch.session"); } catch (e) {}

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function scroll() { log.scrollTop = log.scrollHeight; }

  function renderText(box, text) {
    box.textContent = "";
    var parts = text.split(FENCE);
    for (var i = 0; i < parts.length; i++) {
      if (i % 2 === 0) { if (parts[i]) box.appendChild(el("div", "text", parts[i])); continue; }
      var body = parts[i];
      var nl = body.indexOf("\\n");
      var lang = nl >= 0 ? body.slice(0, nl).trim() : "";
      if (lang === "warren-proposal") { box.appendChild(el("div", "note", "(proposal below)")); continue; }
      box.appendChild(el("pre", "", nl >= 0 ? body.slice(nl + 1) : body));
    }
  }

  function post(path, body) {
    return fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }

  function addCard(id, p) {
    var card = el("div", "card");
    card.appendChild(el("div", "kind", p.kind));
    card.appendChild(el("h3", "", p.title));
    var detail = p.kind === "run" ? "project " + p.project + " | agent " + p.agent + " | max cost $" + p.maxCostUsd + "\\n\\n" + p.prompt
      : p.kind === "plan-run" ? "project " + p.project + " | plan " + p.planId + " | agent " + p.agent + " | max cost per run $" + p.maxCostUsd
      : p.kind === "steer" ? "run " + p.runId + "\\n\\n" + p.body
      : "run " + p.runId + (p.reason ? "\\n" + p.reason : "");
    card.appendChild(el("pre", "", detail));
    var actions = el("div", "actions");
    var go = el("button", "primary", "Launch");
    var no = el("button", "", "Dismiss");
    var status = el("div", "note", "");
    go.onclick = function () {
      go.disabled = true; no.disabled = true; status.textContent = "Launching...";
      post("/api/launch", { id: id }).then(function (r) { return r.json(); }).then(function (j) {
        if (j.ok) {
          var run = j.result && (j.result.run || j.result.planRun);
          status.textContent = "Launched" + (run && run.id ? ": " + run.id : "") + ".";
        } else { status.textContent = "Failed: " + (j.error || "unknown error"); card.classList.add("bad"); go.disabled = false; no.disabled = false; }
      }).catch(function (e) { status.textContent = "Failed: " + e; card.classList.add("bad"); go.disabled = false; no.disabled = false; });
    };
    no.onclick = function () { card.remove(); };
    actions.appendChild(go); actions.appendChild(no);
    card.appendChild(actions); card.appendChild(status);
    log.appendChild(card); scroll();
  }

  function addError(msg) { var c = el("div", "card bad"); c.appendChild(el("div", "text", msg)); log.appendChild(c); scroll(); }

  async function send(text) {
    log.appendChild(el("div", "msg user", text));
    var box = el("div", "msg"); var body = el("div", "text", "..."); box.appendChild(body); var foot = el("div", "note", ""); box.appendChild(foot);
    log.appendChild(box); scroll();
    sendBtn.disabled = true;
    var acc = "";
    try {
      var res = await post("/api/chat", { message: text, sessionId: sessionId });
      if (!res.ok || !res.body) { addError("Chat failed: HTTP " + res.status); return; }
      var reader = res.body.getReader(); var dec = new TextDecoder(); var buf = "";
      for (;;) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buf += dec.decode(chunk.value, { stream: true });
        var nl;
        while ((nl = buf.indexOf("\\n")) >= 0) {
          var line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          if (!line) continue;
          var ev = JSON.parse(line);
          if (ev.t === "delta") { acc += ev.text; renderText(body, acc); scroll(); }
          else if (ev.t === "tool") { foot.textContent = "reading: " + ev.name; }
          else if (ev.t === "proposal") { addCard(ev.id, ev.proposal); }
          else if (ev.t === "proposal-error") { addError("Bad proposal ignored: " + ev.message); }
          else if (ev.t === "error") { addError(ev.message); }
          else if (ev.t === "done") {
            if (ev.sessionId) { sessionId = ev.sessionId; try { localStorage.setItem("orch.session", sessionId); } catch (e) {} }
            foot.textContent = ev.costUsd !== null ? "turn estimate $" + ev.costUsd.toFixed(3) : "";
            refresh();
          }
        }
      }
    } catch (e) { addError("Chat failed: " + e); }
    finally { sendBtn.disabled = false; input.focus(); }
  }

  function refresh() {
    fetch("/api/state").then(function (r) { return r.json(); }).then(function (s) {
      document.getElementById("meta").textContent = s.model + " | effort " + s.effort;
      document.getElementById("snap").textContent = s.snapshot;
    }).catch(function () {});
  }

  document.getElementById("form").onsubmit = function (e) {
    e.preventDefault();
    var t = input.value.trim(); if (!t || sendBtn.disabled) return;
    input.value = ""; send(t);
  };
  input.onkeydown = function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); document.getElementById("form").requestSubmit(); } };
  document.getElementById("newchat").onclick = function () { sessionId = null; try { localStorage.removeItem("orch.session"); } catch (e) {} log.textContent = ""; };
  refresh(); setInterval(refresh, 20000);
})();
</script>
</body>
</html>
`;
