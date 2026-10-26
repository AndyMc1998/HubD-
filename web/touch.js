// HubD touch layer, loaded into Boxedwine's page.
//
// Boxedwine (through SDL) only understands mouse and keyboard, so this turns
// touches into mouse events on the game canvas and adds on-screen buttons for
// the keys Diablo II needs.
(function () {
    "use strict";

    const MOUSE_BUTTON = { left: 0, right: 2 };
    let rightMode = "off"; // "off", "once" or "locked"
    let activeTouch = null; // { id, button }

    // The multi-threaded build needs cross-origin isolation, which only the
    // service worker provides. If this page loaded without it, reload once.
    if (location.pathname.includes("/emu/mt/") && !window.crossOriginIsolated) {
        if (!sessionStorage.getItem("hubd.reloaded")) {
            sessionStorage.setItem("hubd.reloaded", "1");
            location.reload();
            return;
        }
    } else {
        sessionStorage.removeItem("hubd.reloaded");
    }

    // SDL listens on #canvas; the WebGL layer above it ignores pointer events.
    function mouse(type, x, y, button) {
        const target = document.getElementById("canvas");
        const buttons = type === "mouseup" ? 0 : (button === MOUSE_BUTTON.right ? 2 : 1);
        target.dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
            screenX: x,
            screenY: y,
            button: button,
            buttons: type === "mousemove" && !activeTouch ? 0 : buttons,
        }));
    }

    function isGameTouch(event) {
        return event.target && event.target.tagName === "CANVAS";
    }

    function swallow(event) {
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    // Capture phase on window runs before SDL's own touch handlers on the canvas,
    // so the game doesn't see each touch twice.
    window.addEventListener("touchstart", function (event) {
        if (!isGameTouch(event)) return;
        swallow(event);
        if (activeTouch) return; // one finger drives the mouse
        const t = event.changedTouches[0];
        const button = rightMode === "off" ? MOUSE_BUTTON.left : MOUSE_BUTTON.right;
        activeTouch = { id: t.identifier, button: button };
        mouse("mousemove", t.clientX, t.clientY, button);
        mouse("mousedown", t.clientX, t.clientY, button);
        if (rightMode === "once") setRightMode("off");
    }, { capture: true, passive: false });

    window.addEventListener("touchmove", function (event) {
        if (!activeTouch) return;
        swallow(event);
        for (const t of event.changedTouches) {
            if (t.identifier !== activeTouch.id) continue;
                mouse("mousemove", t.clientX, t.clientY, activeTouch.button);
        }
    }, { capture: true, passive: false });

    function endTouch(event) {
        if (!activeTouch) return;
        for (const t of event.changedTouches) {
            if (t.identifier !== activeTouch.id) continue;
            swallow(event);
            mouse("mouseup", t.clientX, t.clientY, activeTouch.button);
            activeTouch = null;
        }
    }
    window.addEventListener("touchend", endTouch, { capture: true, passive: false });
    window.addEventListener("touchcancel", endTouch, { capture: true, passive: false });

    // ---- keyboard ----

    const KEYS = {
        Escape: { code: "Escape", keyCode: 27 },
        Alt: { code: "AltLeft", keyCode: 18 },
        Shift: { code: "ShiftLeft", keyCode: 16 },
        Tab: { code: "Tab", keyCode: 9 },
        Enter: { code: "Enter", keyCode: 13 },
        Space: { code: "Space", keyCode: 32, key: " " },
    };
    function keyInfo(name) {
        if (KEYS[name]) return Object.assign({ key: name }, KEYS[name]);
        const ch = name.toUpperCase();
        if (/^[0-9]$/.test(ch)) return { key: ch, code: "Digit" + ch, keyCode: ch.charCodeAt(0) };
        if (/^F([1-9]|1[0-2])$/.test(ch)) return { key: ch, code: ch, keyCode: 111 + Number(ch.substring(1)) };
        return { key: ch.toLowerCase(), code: "Key" + ch, keyCode: ch.charCodeAt(0) };
    }

    function key(type, name) {
        const info = keyInfo(name);
        const event = new KeyboardEvent(type, {
            bubbles: true,
            cancelable: true,
            key: info.key,
            code: info.code,
            shiftKey: heldKeys.has("Shift"),
            altKey: heldKeys.has("Alt"),
        });
        // keyCode can't be set through the constructor; SDL still reads it.
        Object.defineProperty(event, "keyCode", { get: () => info.keyCode });
        Object.defineProperty(event, "which", { get: () => info.keyCode });
        (document.getElementById("canvas") || document).dispatchEvent(event);
    }

    // Keys that stay down until tapped again (Alt shows item names, Shift attacks in place).
    const heldKeys = new Set();

    // ---- on-screen controls ----

    function button(label, title, onPress) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "hubd-btn";
        b.textContent = label;
        b.title = title;
        b.addEventListener("touchstart", function (event) {
            event.preventDefault();
            event.stopPropagation();
            onPress(b);
        }, { passive: false });
        b.addEventListener("click", function (event) {
            // mouse/desktop fallback; touch already handled above
            if (event.detail === 0 || !("ontouchstart" in window)) onPress(b);
        });
        return b;
    }

    function tapKey(name) {
        key("keydown", name);
        setTimeout(() => key("keyup", name), 60);
    }

    function toggleKey(name, b) {
        if (heldKeys.has(name)) {
            heldKeys.delete(name);
            key("keyup", name);
            b.classList.remove("on");
        } else {
            heldKeys.add(name);
            key("keydown", name);
            b.classList.add("on");
        }
    }

    let rightButton;
    let lastRightTap = 0;
    function setRightMode(mode) {
        rightMode = mode;
        rightButton.classList.toggle("on", mode !== "off");
        rightButton.classList.toggle("locked", mode === "locked");
    }

    function build() {
        const bar = document.createElement("div");
        bar.id = "hubd-bar";

        rightButton = button("R", "Right click (double-tap to lock)", function () {
            const now = Date.now();
            if (now - lastRightTap < 350) setRightMode("locked");
            else setRightMode(rightMode === "off" ? "once" : "off");
            lastRightTap = now;
        });

        const keysPanel = document.createElement("div");
        keysPanel.id = "hubd-keys";
        keysPanel.hidden = true;
        const toggles = ["Alt", "Shift"];
        const taps = ["Escape", "Tab", "I", "C", "S", "Q", "H", "1", "2", "3", "4", "F1", "F2", "F3", "F4", "W", "Enter"];
        const labels = { Escape: "Esc", I: "Inv", C: "Char", S: "Skills", Q: "Quest", H: "Help", W: "Swap", Enter: "\u21b5" };
        toggles.forEach((name) => keysPanel.appendChild(button(name, "Hold " + name + " (tap again to release)", (b) => toggleKey(name, b))));
        taps.forEach((name) => keysPanel.appendChild(button(labels[name] || name, name, () => tapKey(name))));

        const keyboardButton = button("\u2328", "Game keys", function (b) {
            keysPanel.hidden = !keysPanel.hidden;
            b.classList.toggle("on", !keysPanel.hidden);
        });

        const menuButton = button("\u2630", "Show Boxedwine controls and log", function (b) {
            document.body.classList.toggle("hubd-show-ui");
            b.classList.toggle("on");
        });

        bar.appendChild(rightButton);
        bar.appendChild(keyboardButton);
        bar.appendChild(menuButton);
        document.body.appendChild(keysPanel);
        document.body.appendChild(bar);

        // Stop page scrolling/zooming on the game.
        document.addEventListener("gesturestart", (e) => e.preventDefault());
        document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", build);
    } else {
        build();
    }
})();
