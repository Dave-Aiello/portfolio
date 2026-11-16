/* Shared by the board pages: loads the Gallery screens in hidden frames so a board
   can copy real markup (status bar, launch mark, filters) instead of duplicating it. */
window.harvest = async function () {
  const P = "../../../prototype/magic-dragon/";
  const list = await fetch(P + "screens.json").then((r) => r.json());
  const docs = [];
  for (const s of list) {
    const f = document.createElement("iframe");
    f.style.cssText = "position:absolute;left:-3000px;top:0;width:390px;height:844px;border:0";
    document.body.appendChild(f);
    await new Promise((res) => { f.onload = res; f.src = P + s.file; });
    await f.contentDocument.fonts.ready;
    docs.push(f.contentDocument);
  }
  const defs = docs.map((d) => d.querySelector("body > svg defs")).find(Boolean);
  if (defs) document.body.insertAdjacentHTML("afterbegin", '<svg width="0" height="0" style="position:absolute" aria-hidden="true">' + defs.outerHTML + "</svg>");
  const find = (sel, ok) => { for (const d of docs) for (const el of d.querySelectorAll(sel)) if (!ok || ok(el)) return el; return null; };
  function copy(el) {
    const c = document.importNode(el, true);
    const a = [el, ...el.querySelectorAll("*")], b = [c, ...c.querySelectorAll("*")];
    a.forEach((s, i) => { if (s.tagName === "IMG") b[i].src = s.src; });
    return c;
  }
  const manifest = await fetch(P + "assets/manifest.json").then((r) => r.json()).catch(() => ({}));
  const asset = (rel) => P + "assets/" + (manifest[rel] || rel);
  async function settle() {
    await Promise.all([...document.images].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; })));
    await document.fonts.ready;
  }
  return { P, list, docs, find, copy, settle, asset };
};
