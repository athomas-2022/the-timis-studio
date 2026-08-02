// Gallery lightbox + "download all" (client-side, no dependencies).
(() => {
  "use strict";

  // ---------------- Lightbox ----------------
  const grid = document.getElementById("grid");
  const lb = document.getElementById("lightbox");
  if (grid && lb) {
    const tiles = [...grid.querySelectorAll(".tile")];
    const img = document.getElementById("lb-img");
    const caption = document.getElementById("lb-caption");
    const dl = document.getElementById("lb-download");
    let idx = 0;

    const show = i => {
      idx = (i + tiles.length) % tiles.length;
      const t = tiles[idx];
      img.src = t.getAttribute("href");
      img.alt = t.dataset.name || "";
      if (caption) caption.textContent = `${idx + 1} / ${tiles.length}`;
      if (dl && t.dataset.orig) { dl.href = t.dataset.orig; dl.setAttribute("download", t.dataset.name || ""); dl.style.display = ""; }
      else if (dl) dl.style.display = "none";
    };
    const open = i => { show(i); lb.classList.add("open"); lb.setAttribute("aria-hidden", "false"); document.body.style.overflow = "hidden"; };
    const close = () => { lb.classList.remove("open"); lb.setAttribute("aria-hidden", "true"); document.body.style.overflow = ""; img.src = ""; };

    tiles.forEach((t, i) => t.addEventListener("click", e => { e.preventDefault(); open(i); }));
    lb.querySelector(".lb-close").addEventListener("click", close);
    lb.querySelector(".lb-prev").addEventListener("click", () => show(idx - 1));
    lb.querySelector(".lb-next").addEventListener("click", () => show(idx + 1));
    lb.addEventListener("click", e => { if (e.target === lb) close(); });
    document.addEventListener("keydown", e => {
      if (!lb.classList.contains("open")) return;
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") show(idx + 1);
      else if (e.key === "ArrowLeft") show(idx - 1);
    });
  }

  // ---------------- Download all ----------------
  const dlAll = document.getElementById("download-all");
  if (dlAll) dlAll.addEventListener("click", onDownloadAll);

  const MAX_ZIP_BYTES = 1_200_000_000; // ~1.2 GB: above this, fall back to per-file downloads

  async function onDownloadAll(e) {
    e.preventDefault();
    const base = location.pathname.replace(/\/?$/, "/");
    let manifest;
    try { manifest = await (await fetch(base + "manifest.json")).json(); }
    catch { alert("Could not load the download list. Please try again."); return; }

    const files = (manifest.files || []).filter(f => f && f.name);
    if (!files.length) { alert("Nothing to download."); return; }

    const total = files.reduce((n, f) => n + (f.size || 0), 0);
    const label = dlAll.textContent;
    dlAll.style.pointerEvents = "none";

    try {
      if (total > MAX_ZIP_BYTES) {
        // Too large to zip in memory — download originals one by one.
        for (let i = 0; i < files.length; i++) {
          dlAll.textContent = `Downloading ${i + 1}/${files.length}…`;
          triggerDownload(base + "orig/" + encodeURIComponent(files[i].name), files[i].name);
          await sleep(400);
        }
      } else {
        const entries = [];
        for (let i = 0; i < files.length; i++) {
          dlAll.textContent = `Preparing ${i + 1}/${files.length}…`;
          const buf = new Uint8Array(await (await fetch(base + "orig/" + encodeURIComponent(files[i].name))).arrayBuffer());
          entries.push({ name: files[i].name, data: buf });
        }
        dlAll.textContent = "Zipping…";
        const blob = buildZip(entries);
        const zipName = (manifest.title || "gallery").replace(/[^\w.-]+/g, "-") + ".zip";
        const url = URL.createObjectURL(blob);
        triggerDownload(url, zipName);
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
    } catch (err) {
      console.error(err);
      alert("Download failed. You can still open each photo and save it individually.");
    } finally {
      dlAll.textContent = label;
      dlAll.style.pointerEvents = "";
    }
  }

  function triggerDownload(href, name) {
    const a = document.createElement("a");
    a.href = href; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ---- Minimal store-only (no compression) ZIP builder ----
  // JPEGs are already compressed, so "store" keeps it simple and fast with zero deps.
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function buildZip(entries) {
    const enc = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;

    const u16 = v => new Uint8Array([v & 0xFF, (v >>> 8) & 0xFF]);
    const u32 = v => new Uint8Array([v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]);
    const push = (arr, a) => { arr.push(a); return a.length; };

    for (const { name, data } of entries) {
      const nameBytes = enc.encode(name);
      const crc = crc32(data);
      const size = data.length;

      let local = 0;
      local += push(chunks, u32(0x04034b50));
      local += push(chunks, u16(20));          // version needed
      local += push(chunks, u16(0));           // flags
      local += push(chunks, u16(0));           // method: store
      local += push(chunks, u16(0));           // mod time
      local += push(chunks, u16(0x21));        // mod date (1980-01-01)
      local += push(chunks, u32(crc));
      local += push(chunks, u32(size));        // compressed
      local += push(chunks, u32(size));        // uncompressed
      local += push(chunks, u16(nameBytes.length));
      local += push(chunks, u16(0));           // extra len
      local += push(chunks, nameBytes);
      local += push(chunks, data);

      const cd = [];
      push(cd, u32(0x02014b50));
      push(cd, u16(20)); push(cd, u16(20));    // version made by / needed
      push(cd, u16(0)); push(cd, u16(0));      // flags / method
      push(cd, u16(0)); push(cd, u16(0x21));   // time / date
      push(cd, u32(crc)); push(cd, u32(size)); push(cd, u32(size));
      push(cd, u16(nameBytes.length));
      push(cd, u16(0)); push(cd, u16(0));      // extra / comment len
      push(cd, u16(0)); push(cd, u16(0));      // disk / internal attrs
      push(cd, u32(0));                        // external attrs
      push(cd, u32(offset));                   // local header offset
      push(cd, nameBytes);
      central.push(...cd);

      offset += local;
    }

    const cdStart = offset;
    let cdSize = 0;
    for (const c of central) { chunks.push(c); cdSize += c.length; }

    const end = [];
    end.push(u32(0x06054b50));
    end.push(u16(0)); end.push(u16(0));
    end.push(u16(entries.length)); end.push(u16(entries.length));
    end.push(u32(cdSize)); end.push(u32(cdStart));
    end.push(u16(0));
    for (const e of end) chunks.push(e);

    return new Blob(chunks, { type: "application/zip" });
  }
})();
