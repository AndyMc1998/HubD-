"use strict";

const GAME_CACHE = "hubd-games"; // keep in sync with sw.js
const GAME_SLUG = "diablo2";
const META_KEY = "hubd.game";
const SETTINGS_KEY = "hubd.settings";

const $ = (id) => document.getElementById(id);

function readJson(key) {
    try {
        return JSON.parse(localStorage.getItem(key) || "null");
    } catch (e) {
        return null;
    }
}

function writeJson(key, value) {
    try {
        if (value === null) {
            localStorage.removeItem(key);
        } else {
            localStorage.setItem(key, JSON.stringify(value));
        }
    } catch (e) {
        // private mode: settings just won't be remembered
    }
}

function formatSize(bytes) {
    if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + " GB";
    return Math.round(bytes / 1e6) + " MB";
}

function gameUrl() {
    return new URL("games/" + GAME_SLUG + ".zip", location.href).href;
}

// ---- zip reading: find Game.exe without loading the whole file ----

async function bytesAt(file, start, length) {
    return new DataView(await file.slice(start, start + length).arrayBuffer());
}

async function centralDirectory(file) {
    const tailLength = Math.min(file.size, 65557);
    const tail = await bytesAt(file, file.size - tailLength, tailLength);
    for (let i = tailLength - 22; i >= 0; i--) {
        if (tail.getUint32(i, true) !== 0x06054b50) continue;
        let count = tail.getUint16(i + 10, true);
        let size = tail.getUint32(i + 12, true);
        let offset = tail.getUint32(i + 16, true);
        // ZIP64: the real values live in another record
        if (offset === 0xffffffff || size === 0xffffffff || count === 0xffff) {
            const locatorAt = i - 20;
            if (locatorAt < 0 || tail.getUint32(locatorAt, true) !== 0x07064b50) {
                throw new Error("Unsupported zip file");
            }
            const recordOffset = Number(tail.getBigUint64(locatorAt + 8, true));
            const record = await bytesAt(file, recordOffset, 56);
            if (record.getUint32(0, true) !== 0x06064b50) throw new Error("Unsupported zip file");
            count = Number(record.getBigUint64(32, true));
            size = Number(record.getBigUint64(40, true));
            offset = Number(record.getBigUint64(48, true));
        }
        return { count, view: await bytesAt(file, offset, size) };
    }
    throw new Error("This doesn't look like a zip file");
}

async function zipFileNames(file) {
    const { count, view } = await centralDirectory(file);
    const names = [];
    const decoder = new TextDecoder();
    let p = 0;
    for (let n = 0; n < count && p + 46 <= view.byteLength; n++) {
        if (view.getUint32(p, true) !== 0x02014b50) break;
        const nameLength = view.getUint16(p + 28, true);
        const extraLength = view.getUint16(p + 30, true);
        const commentLength = view.getUint16(p + 32, true);
        const name = new Uint8Array(view.buffer, view.byteOffset + p + 46, nameLength);
        names.push(decoder.decode(name).replace(/\\/g, "/"));
        p += 46 + nameLength + extraLength + commentLength;
    }
    return names;
}

// Explains the usual wrong zips: an installer, a disc image, or Resurrected.
function missingExeMessage(names) {
    const files = names.filter((name) => !name.endsWith("/") && !name.startsWith("__MACOSX/"));
    const has = (pattern) => files.some((name) => pattern.test(name));
    let reason = "Zip the folder Diablo II is installed in (it has Game.exe and .mpq files).";
    if (has(/(^|\/)d2r\.exe$/i)) {
        reason = "This is Diablo II: Resurrected, which can't run here. You need the original Diablo II (2000).";
    } else if (has(/\.(iso|bin|cue|mdf|nrg)$/i)) {
        reason = "This is a disc image. Install the game on a Windows PC, then zip the folder it installed into.";
    } else if (has(/(^|\/)(setup|install|installer)[^/]*\.exe$/i) || has(/installer tome\.mpq$/i)) {
        reason = "This is the installer. Run it on a Windows PC, then zip the folder it installed into (usually C:\\Program Files (x86)\\Diablo II).";
    }
    const sample = files.slice(0, 8).join(", ");
    return "No Game.exe in this zip. " + reason + (sample ? " Found: " + sample + (files.length > 8 ? "…" : "") : " The zip is empty.");
}

async function findGameExe(file) {
    const names = await zipFileNames(file);
    const exes = names
        .filter((name) => /(^|\/)game\.exe$/i.test(name) && !name.startsWith("__MACOSX/"))
        .sort((a, b) => a.split("/").length - b.split("/").length);
    if (exes.length === 0) {
        throw new Error(missingExeMessage(names));
    }
    const mpqs = names.filter((name) => /\.mpq$/i.test(name)).length;
    return { exe: exes[0], mpqs: mpqs };
}

// ---- storage ----

async function saveGame(file) {
    const status = $("file-status");
    status.textContent = "Checking zip…";
    const { exe, mpqs } = await findGameExe(file);
    if (navigator.storage && navigator.storage.persist) {
        await navigator.storage.persist().catch(() => {});
    }
    status.textContent = "Saving to this device (" + formatSize(file.size) + ")… keep this page open.";
    const cache = await caches.open(GAME_CACHE);
    await cache.put(gameUrl(), new Response(file, {
        headers: { "Content-Type": "application/zip", "Content-Length": String(file.size) },
    }));
    const meta = { name: file.name, size: file.size, exe: exe, mpqs: mpqs, saved: Date.now() };
    writeJson(META_KEY, meta);
    status.textContent = mpqs === 0
        ? "Saved, but no .mpq data files were found. The game probably won't start."
        : "Saved. Ready to play.";
    return meta;
}

async function forgetGame() {
    await caches.open(GAME_CACHE).then((cache) => cache.delete(gameUrl()));
    writeJson(META_KEY, null);
    $("file-status").textContent = "Removed.";
    render();
}

async function hasSavedGame() {
    const meta = readJson(META_KEY);
    if (!meta) return null;
    const hit = await caches.open(GAME_CACHE).then((cache) => cache.match(gameUrl()));
    return hit ? meta : null;
}

// ---- settings and launch ----

const SETTING_IDS = ["engine", "resolution", "windowed", "gdi", "sound", "args"];

function loadSettings() {
    const saved = readJson(SETTINGS_KEY) || {};
    for (const id of SETTING_IDS) {
        if (!(id in saved)) continue;
        const el = $(id);
        if (el.type === "checkbox") el.checked = !!saved[id];
        else el.value = saved[id];
    }
}

function saveSettings() {
    const values = {};
    for (const id of SETTING_IDS) {
        const el = $(id);
        values[id] = el.type === "checkbox" ? el.checked : el.value;
    }
    writeJson(SETTINGS_KEY, values);
}

function launchUrl(meta) {
    const slash = meta.exe.lastIndexOf("/");
    const folder = slash >= 0 ? meta.exe.substring(0, slash) : "";
    const exe = meta.exe.substring(slash + 1);
    const args = [];
    if ($("windowed").checked) args.push("-w");
    if (!$("sound").checked) args.push("-ns");
    if ($("args").value.trim()) args.push($("args").value.trim());

    const params = [
        ["app", GAME_SLUG],
        ["appBase", "../../games/"],
        ["root", "boxedwine"],
        ["rootBase", "../../wine/"],
        ["p", exe],
        ["w", "c:/files" + (folder ? "/" + folder : "")],
        ["resolution", $("resolution").value],
        ["wine-override", "[nomono]"],
        ["sound", $("sound").checked ? "true" : "false"],
    ];
    if ($("gdi").checked) params.push(["registry", "[gdi]"]);
    if (args.length) params.push(["args", args.join(" ")]);
    const query = params.map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&");
    return "emu/" + $("engine").value + "/boxedwine.html?" + query;
}

async function play() {
    const meta = await hasSavedGame();
    if (!meta) {
        $("file-status").textContent = "Pick your game zip first.";
        return;
    }
    saveSettings();
    // The service worker must control the game page to serve the zip.
    await navigator.serviceWorker.ready;
    location.href = launchUrl(meta);
}

// ---- page ----

function checkSupport() {
    const problems = [];
    if (!("serviceWorker" in navigator)) problems.push("This browser can't run HubD (no service workers). On iPhone use Safari, and not a private tab.");
    if (typeof WebAssembly !== "object") problems.push("WebAssembly is not available.");
    if (!window.caches) problems.push("Storage is not available. Private browsing blocks it.");
    const ios = navigator.userAgent.match(/OS (\d+)_(\d+)/);
    if (ios && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
        const major = Number(ios[1]), minor = Number(ios[2]);
        if (major < 18 || (major === 18 && minor < 4)) {
            problems.push("Boxedwine needs iOS 18.4 or newer. Update iOS in Settings → General → Software Update.");
        }
    }
    if (problems.length) {
        const box = $("support");
        box.hidden = false;
        box.innerHTML = "<h2>Heads up</h2>" + problems.map((p) => "<p>" + p + "</p>").join("");
    }
    return "serviceWorker" in navigator && !!window.caches;
}

async function render() {
    const meta = await hasSavedGame();
    $("game-none").hidden = !!meta;
    $("game-saved").hidden = !meta;
    $("forget").hidden = !meta;
    $("play").disabled = !meta;
    $("file-label").textContent = meta ? "Choose a different zip…" : "Choose zip…";
    if (meta) {
        $("game-name").textContent = meta.name;
        $("game-size").textContent = " · " + formatSize(meta.size);
        $("game-exe").textContent = meta.exe;
    }
}

async function main() {
    if (!checkSupport()) return;
    navigator.serviceWorker.register("sw.js").catch((e) => {
        $("file-status").textContent = "Couldn't start the service worker: " + e.message;
    });
    loadSettings();
    for (const id of SETTING_IDS) $(id).addEventListener("change", saveSettings);
    $("file").addEventListener("change", async (event) => {
        const file = event.target.files[0];
        event.target.value = "";
        if (!file) return;
        try {
            await saveGame(file);
        } catch (e) {
            $("file-status").textContent = e.message;
        }
        render();
    });
    $("forget").addEventListener("click", forgetGame);
    $("play").addEventListener("click", play);
    render();
}

main();
