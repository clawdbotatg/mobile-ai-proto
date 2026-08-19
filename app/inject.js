// inject.js — the command runner injected into every page the WebView loads.
// Defines window.__runCmd(cmd, args) -> result object (throws on failure).
// Kept as a CJS string so node tests can load the exact same code into a page.

const INJECT = `
window.__runCmd = function (cmd, a) {
  a = a || {};
  function vis(el) {
    var r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < window.innerHeight;
  }
  function label(el) {
    return (el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || el.title || '')
      .trim().replace(/\\s+/g, ' ').slice(0, 80);
  }
  if (cmd === 'read') {
    return {
      url: location.href,
      title: document.title,
      text: (document.body && document.body.innerText || '').replace(/\\n{3,}/g, '\\n\\n').slice(0, 7000)
    };
  }
  if (cmd === 'ui') {
    var sel = 'a, button, input, textarea, select, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="checkbox"], [role="option"], [contenteditable="true"]';
    var els = Array.prototype.slice.call(document.querySelectorAll(sel)).filter(vis).slice(0, 120);
    window.__els = els;
    return {
      url: location.href,
      items: els.map(function (el, i) {
        var tag = el.tagName.toLowerCase() + (el.type ? '[' + el.type + ']' : '');
        return i + ': [' + tag + '] ' + (label(el) || '(no label)');
      })
    };
  }
  if (cmd === 'tapi') {
    var el = (window.__els || [])[a.n];
    if (!el) throw new Error('no such index — run ui again');
    if (el.focus) el.focus();
    el.click();
    return { url: location.href };
  }
  if (cmd === 'tap') {
    var all = document.querySelectorAll('a, button, [role="button"], [role="link"], [role="menuitem"], input[type="submit"], input[type="button"]');
    var want = String(a.text || '').toLowerCase();
    for (var i = 0; i < all.length; i++) {
      var el2 = all[i];
      if (vis(el2) && label(el2).toLowerCase().indexOf(want) >= 0) {
        if (el2.focus) el2.focus();
        el2.click();
        return { url: location.href };
      }
    }
    throw new Error('no clickable element containing "' + a.text + '"');
  }
  if (cmd === 'type') {
    var el3 = document.activeElement;
    if (!el3 || el3 === document.body) throw new Error('nothing focused — tap a field first');
    if (el3.isContentEditable) {
      document.execCommand('insertText', false, a.text);
    } else {
      var proto = el3.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el3, (el3.value || '') + a.text);
      el3.dispatchEvent(new Event('input', { bubbles: true }));
      el3.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return { typed: true };
  }
  if (cmd === 'press') {
    var el4 = document.activeElement || document.body;
    var init = { key: a.key, code: a.key, keyCode: a.key === 'Enter' ? 13 : 0, which: a.key === 'Enter' ? 13 : 0, bubbles: true, cancelable: true };
    el4.dispatchEvent(new KeyboardEvent('keydown', init));
    el4.dispatchEvent(new KeyboardEvent('keypress', init));
    el4.dispatchEvent(new KeyboardEvent('keyup', init));
    if (a.key === 'Enter' && el4.form) {
      if (el4.form.requestSubmit) el4.form.requestSubmit(); else el4.form.submit();
    }
    return { url: location.href };
  }
  if (cmd === 'scroll') {
    window.scrollBy(0, a.dy || 600);
    return { y: window.scrollY };
  }
  throw new Error('unknown cmd ' + cmd);
};
true;
`;

module.exports = { INJECT };
