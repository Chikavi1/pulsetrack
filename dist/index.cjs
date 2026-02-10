'use strict';

let config = null;
function initConfig(userConfig) {
    console.log('Initializing config with:', userConfig);
    if (config) {
        console.warn('PulseTrack already initialized');
        return config;
    }
    const DEFAULT_ENDPOINT = 'https://api.rojastudio.xyz';
    config = {
        endpoint: DEFAULT_ENDPOINT,
        environment: 'prod',
        ...userConfig,
    };
    console.log('Final config:', config);
    return config;
}
function getConfig() {
    if (!config) {
        throw new Error('PulseTrack not init. Call PulseTrack.init() first.');
    }
    return config;
}

class SessionManager {
    static getSession() {
        const raw = sessionStorage.getItem(this.KEY);
        if (!raw) {
            return this.createSession();
        }
        const session = JSON.parse(raw);
        const expired = Date.now() - session.startedAt > this.MAX_DURATION_MS;
        if (expired) {
            return this.createSession(true);
        }
        return session;
    }
    static getSessionId() {
        return this.getSession().id;
    }
    static isExpired() {
        const raw = sessionStorage.getItem(this.KEY);
        if (!raw)
            return false;
        const { startedAt } = JSON.parse(raw);
        return Date.now() - startedAt > this.MAX_DURATION_MS;
    }
    static createSession(expired = false) {
        const session = {
            id: crypto.randomUUID(),
            startedAt: Date.now(),
            expiredFromPrevious: expired,
        };
        sessionStorage.setItem(this.KEY, JSON.stringify(session));
        return session;
    }
    static reset() {
        sessionStorage.removeItem(this.KEY);
    }
}
SessionManager.KEY = 'rrweb_session';
SessionManager.MAX_DURATION_MS = 30 * 60 * 1000; // 30 min

class RRWebOrchestrator {
    constructor(tracker, sendFn) {
        this.tracker = tracker;
        this.sendFn = sendFn;
        this.intervalId = null;
        this.flushing = false;
        this.FLUSH_INTERVAL = 5000;
        this.MAX_EVENTS = 80;
    }
    start() {
        this.tracker.start();
        this.intervalId = setInterval(() => {
            this.flush(false, 'interval');
        }, this.FLUSH_INTERVAL);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                this.flush(true, 'visibility');
            }
        });
        window.addEventListener('pagehide', () => {
            this.flush(true, 'pagehide');
        });
        window.addEventListener('beforeunload', () => {
            this.flush(true, 'unload');
        });
    }
    stop() {
        if (this.intervalId)
            clearInterval(this.intervalId);
        this.intervalId = null;
        this.tracker.stop();
    }
    onEventTick() {
        if (this.tracker.getBufferSize() >= this.MAX_EVENTS) {
            this.flush(false, 'max-events');
        }
    }
    async flush(force = false, reason = 'interval') {
        if (this.flushing)
            return;
        if (SessionManager.isExpired()) {
            const events = this.tracker.peek();
            if (events.length) {
                await this.sendFn({
                    sessionId: SessionManager.getSessionId(),
                    events,
                    sentAt: Date.now(),
                    reason: 'expired',
                });
                this.tracker.commit();
            }
            this.tracker.stop();
            SessionManager.reset();
            this.tracker.start();
            return;
        }
        if (!this.tracker.canFlush() && !force)
            return;
        const events = this.tracker.peek();
        if (!events.length)
            return;
        this.flushing = true;
        const ok = await this.sendFn({
            sessionId: SessionManager.getSessionId(),
            events,
            sentAt: Date.now(),
            reason,
        });
        if (ok) {
            this.tracker.commit();
        }
        this.flushing = false;
    }
}

function getApiBaseUrl() {
    const config = getConfig();
    return config.endpoint || 'https://api.rojastudio.xyz';
}
function getApiUrl(path) {
    const baseUrl = getApiBaseUrl();
    return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

async function sendToBackend(chunk) {
    try {
        const isFirstChunk = chunk.events.some(e => e.type === 2);
        const isExit = chunk.reason === 'pagehide' ||
            chunk.reason === 'unload';
        const payload = {
            ...chunk,
            pageUrl: location.href,
            referrer: document.referrer,
            clientInfo: isFirstChunk ? await collectClientInfo() : undefined,
        };
        const res = await fetch(getApiUrl('sessions/ingest'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': 'Bearer ' + payload.token,
            },
            body: JSON.stringify(payload),
            keepalive: isExit,
        });
        return res.ok;
    }
    catch {
        return false;
    }
}
async function collectClientInfo() {
    return {
        browser: await detectBrowser(),
        language: navigator.language,
        languages: navigator.languages,
        platform: navigator.platform,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        deviceType: /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop',
        isBot: false,
        fingerprint: null,
        screen: {
            width: window.screen.width,
            height: window.screen.height,
            dpr: window.devicePixelRatio,
        },
        hardware: {
            memory: navigator.deviceMemory ?? null,
            cores: navigator.hardwareConcurrency ?? null,
        },
    };
}
async function detectBrowser() {
    const nav = navigator;
    if (nav.userAgentData?.brands?.length) {
        return nav.userAgentData.brands
            .map((b) => b.brand)
            .join(', ');
    }
    const ua = navigator.userAgent;
    if (/Firefox\/\d+/i.test(ua))
        return 'Firefox';
    if (/Edg\/\d+/i.test(ua))
        return 'Edge';
    if (/Brave/i.test(ua))
        return 'Brave';
    if (/Chrome\/\d+/i.test(ua))
        return 'Chrome';
    if (/Safari\/\d+/i.test(ua))
        return 'Safari';
    return 'Unknown';
}

var NodeType;
(function (NodeType) {
    NodeType[NodeType["Document"] = 0] = "Document";
    NodeType[NodeType["DocumentType"] = 1] = "DocumentType";
    NodeType[NodeType["Element"] = 2] = "Element";
    NodeType[NodeType["Text"] = 3] = "Text";
    NodeType[NodeType["CDATA"] = 4] = "CDATA";
    NodeType[NodeType["Comment"] = 5] = "Comment";
})(NodeType || (NodeType = {}));

function isElement(n) {
    return n.nodeType === n.ELEMENT_NODE;
}
function isShadowRoot(n) {
    var host = n === null || n === void 0 ? void 0 : n.host;
    return Boolean((host === null || host === void 0 ? void 0 : host.shadowRoot) === n);
}
function isNativeShadowDom(shadowRoot) {
    return Object.prototype.toString.call(shadowRoot) === '[object ShadowRoot]';
}
function fixBrowserCompatibilityIssuesInCSS(cssText) {
    if (cssText.includes(' background-clip: text;') &&
        !cssText.includes(' -webkit-background-clip: text;')) {
        cssText = cssText.replace(' background-clip: text;', ' -webkit-background-clip: text; background-clip: text;');
    }
    return cssText;
}
function getCssRulesString(s) {
    try {
        var rules = s.rules || s.cssRules;
        return rules
            ? fixBrowserCompatibilityIssuesInCSS(Array.from(rules).map(getCssRuleString).join(''))
            : null;
    }
    catch (error) {
        return null;
    }
}
function getCssRuleString(rule) {
    var cssStringified = rule.cssText;
    if (isCSSImportRule(rule)) {
        try {
            cssStringified = getCssRulesString(rule.styleSheet) || cssStringified;
        }
        catch (_a) {
        }
    }
    return cssStringified;
}
function isCSSImportRule(rule) {
    return 'styleSheet' in rule;
}
var Mirror = (function () {
    function Mirror() {
        this.idNodeMap = new Map();
        this.nodeMetaMap = new WeakMap();
    }
    Mirror.prototype.getId = function (n) {
        var _a;
        if (!n)
            return -1;
        var id = (_a = this.getMeta(n)) === null || _a === void 0 ? void 0 : _a.id;
        return id !== null && id !== void 0 ? id : -1;
    };
    Mirror.prototype.getNode = function (id) {
        return this.idNodeMap.get(id) || null;
    };
    Mirror.prototype.getIds = function () {
        return Array.from(this.idNodeMap.keys());
    };
    Mirror.prototype.getMeta = function (n) {
        return this.nodeMetaMap.get(n) || null;
    };
    Mirror.prototype.removeNodeFromMap = function (n) {
        var _this = this;
        var id = this.getId(n);
        this.idNodeMap["delete"](id);
        if (n.childNodes) {
            n.childNodes.forEach(function (childNode) {
                return _this.removeNodeFromMap(childNode);
            });
        }
    };
    Mirror.prototype.has = function (id) {
        return this.idNodeMap.has(id);
    };
    Mirror.prototype.hasNode = function (node) {
        return this.nodeMetaMap.has(node);
    };
    Mirror.prototype.add = function (n, meta) {
        var id = meta.id;
        this.idNodeMap.set(id, n);
        this.nodeMetaMap.set(n, meta);
    };
    Mirror.prototype.replace = function (id, n) {
        var oldNode = this.getNode(id);
        if (oldNode) {
            var meta = this.nodeMetaMap.get(oldNode);
            if (meta)
                this.nodeMetaMap.set(n, meta);
        }
        this.idNodeMap.set(id, n);
    };
    Mirror.prototype.reset = function () {
        this.idNodeMap = new Map();
        this.nodeMetaMap = new WeakMap();
    };
    return Mirror;
}());
function createMirror() {
    return new Mirror();
}
function maskInputValue(_a) {
    var maskInputOptions = _a.maskInputOptions, tagName = _a.tagName, type = _a.type, value = _a.value, maskInputFn = _a.maskInputFn;
    var text = value || '';
    if (maskInputOptions[tagName.toLowerCase()] ||
        maskInputOptions[type]) {
        if (maskInputFn) {
            text = maskInputFn(text);
        }
        else {
            text = '*'.repeat(text.length);
        }
    }
    return text;
}
var ORIGINAL_ATTRIBUTE_NAME = '__rrweb_original__';
function is2DCanvasBlank(canvas) {
    var ctx = canvas.getContext('2d');
    if (!ctx)
        return true;
    var chunkSize = 50;
    for (var x = 0; x < canvas.width; x += chunkSize) {
        for (var y = 0; y < canvas.height; y += chunkSize) {
            var getImageData = ctx.getImageData;
            var originalGetImageData = ORIGINAL_ATTRIBUTE_NAME in getImageData
                ? getImageData[ORIGINAL_ATTRIBUTE_NAME]
                : getImageData;
            var pixelBuffer = new Uint32Array(originalGetImageData.call(ctx, x, y, Math.min(chunkSize, canvas.width - x), Math.min(chunkSize, canvas.height - y)).data.buffer);
            if (pixelBuffer.some(function (pixel) { return pixel !== 0; }))
                return false;
        }
    }
    return true;
}

var _id = 1;
var tagNameRegex = new RegExp('[^a-z0-9-_:]');
var IGNORED_NODE = -2;
function genId() {
    return _id++;
}
function getValidTagName(element) {
    if (element instanceof HTMLFormElement) {
        return 'form';
    }
    var processedTagName = element.tagName.toLowerCase().trim();
    if (tagNameRegex.test(processedTagName)) {
        return 'div';
    }
    return processedTagName;
}
function stringifyStyleSheet(sheet) {
    return sheet.cssRules
        ? Array.from(sheet.cssRules)
            .map(function (rule) { return rule.cssText || ''; })
            .join('')
        : '';
}
function extractOrigin(url) {
    var origin = '';
    if (url.indexOf('//') > -1) {
        origin = url.split('/').slice(0, 3).join('/');
    }
    else {
        origin = url.split('/')[0];
    }
    origin = origin.split('?')[0];
    return origin;
}
var canvasService;
var canvasCtx;
var URL_IN_CSS_REF = /url\((?:(')([^']*)'|(")(.*?)"|([^)]*))\)/gm;
var RELATIVE_PATH = /^(?!www\.|(?:http|ftp)s?:\/\/|[A-Za-z]:\\|\/\/|#).*/;
var DATA_URI = /^(data:)([^,]*),(.*)/i;
function absoluteToStylesheet(cssText, href) {
    return (cssText || '').replace(URL_IN_CSS_REF, function (origin, quote1, path1, quote2, path2, path3) {
        var filePath = path1 || path2 || path3;
        var maybeQuote = quote1 || quote2 || '';
        if (!filePath) {
            return origin;
        }
        if (!RELATIVE_PATH.test(filePath)) {
            return "url(".concat(maybeQuote).concat(filePath).concat(maybeQuote, ")");
        }
        if (DATA_URI.test(filePath)) {
            return "url(".concat(maybeQuote).concat(filePath).concat(maybeQuote, ")");
        }
        if (filePath[0] === '/') {
            return "url(".concat(maybeQuote).concat(extractOrigin(href) + filePath).concat(maybeQuote, ")");
        }
        var stack = href.split('/');
        var parts = filePath.split('/');
        stack.pop();
        for (var _i = 0, parts_1 = parts; _i < parts_1.length; _i++) {
            var part = parts_1[_i];
            if (part === '.') {
                continue;
            }
            else if (part === '..') {
                stack.pop();
            }
            else {
                stack.push(part);
            }
        }
        return "url(".concat(maybeQuote).concat(stack.join('/')).concat(maybeQuote, ")");
    });
}
var SRCSET_NOT_SPACES = /^[^ \t\n\r\u000c]+/;
var SRCSET_COMMAS_OR_SPACES = /^[, \t\n\r\u000c]+/;
function getAbsoluteSrcsetString(doc, attributeValue) {
    if (attributeValue.trim() === '') {
        return attributeValue;
    }
    var pos = 0;
    function collectCharacters(regEx) {
        var chars;
        var match = regEx.exec(attributeValue.substring(pos));
        if (match) {
            chars = match[0];
            pos += chars.length;
            return chars;
        }
        return '';
    }
    var output = [];
    while (true) {
        collectCharacters(SRCSET_COMMAS_OR_SPACES);
        if (pos >= attributeValue.length) {
            break;
        }
        var url = collectCharacters(SRCSET_NOT_SPACES);
        if (url.slice(-1) === ',') {
            url = absoluteToDoc(doc, url.substring(0, url.length - 1));
            output.push(url);
        }
        else {
            var descriptorsStr = '';
            url = absoluteToDoc(doc, url);
            var inParens = false;
            while (true) {
                var c = attributeValue.charAt(pos);
                if (c === '') {
                    output.push((url + descriptorsStr).trim());
                    break;
                }
                else if (!inParens) {
                    if (c === ',') {
                        pos += 1;
                        output.push((url + descriptorsStr).trim());
                        break;
                    }
                    else if (c === '(') {
                        inParens = true;
                    }
                }
                else {
                    if (c === ')') {
                        inParens = false;
                    }
                }
                descriptorsStr += c;
                pos += 1;
            }
        }
    }
    return output.join(', ');
}
function absoluteToDoc(doc, attributeValue) {
    if (!attributeValue || attributeValue.trim() === '') {
        return attributeValue;
    }
    var a = doc.createElement('a');
    a.href = attributeValue;
    return a.href;
}
function isSVGElement(el) {
    return Boolean(el.tagName === 'svg' || el.ownerSVGElement);
}
function getHref() {
    var a = document.createElement('a');
    a.href = '';
    return a.href;
}
function transformAttribute(doc, tagName, name, value) {
    if (name === 'src' ||
        (name === 'href' && value && !(tagName === 'use' && value[0] === '#'))) {
        return absoluteToDoc(doc, value);
    }
    else if (name === 'xlink:href' && value && value[0] !== '#') {
        return absoluteToDoc(doc, value);
    }
    else if (name === 'background' &&
        value &&
        (tagName === 'table' || tagName === 'td' || tagName === 'th')) {
        return absoluteToDoc(doc, value);
    }
    else if (name === 'srcset' && value) {
        return getAbsoluteSrcsetString(doc, value);
    }
    else if (name === 'style' && value) {
        return absoluteToStylesheet(value, getHref());
    }
    else if (tagName === 'object' && name === 'data' && value) {
        return absoluteToDoc(doc, value);
    }
    else {
        return value;
    }
}
function _isBlockedElement(element, blockClass, blockSelector) {
    if (typeof blockClass === 'string') {
        if (element.classList.contains(blockClass)) {
            return true;
        }
    }
    else {
        for (var eIndex = element.classList.length; eIndex--;) {
            var className = element.classList[eIndex];
            if (blockClass.test(className)) {
                return true;
            }
        }
    }
    if (blockSelector) {
        return element.matches(blockSelector);
    }
    return false;
}
function classMatchesRegex(node, regex, checkAncestors) {
    if (!node)
        return false;
    if (node.nodeType !== node.ELEMENT_NODE) {
        if (!checkAncestors)
            return false;
        return classMatchesRegex(node.parentNode, regex, checkAncestors);
    }
    for (var eIndex = node.classList.length; eIndex--;) {
        var className = node.classList[eIndex];
        if (regex.test(className)) {
            return true;
        }
    }
    if (!checkAncestors)
        return false;
    return classMatchesRegex(node.parentNode, regex, checkAncestors);
}
function needMaskingText(node, maskTextClass, maskTextSelector) {
    var el = node.nodeType === node.ELEMENT_NODE
        ? node
        : node.parentElement;
    if (el === null)
        return false;
    if (typeof maskTextClass === 'string') {
        if (el.classList.contains(maskTextClass))
            return true;
        if (el.closest(".".concat(maskTextClass)))
            return true;
    }
    else {
        if (classMatchesRegex(el, maskTextClass, true))
            return true;
    }
    if (maskTextSelector) {
        if (el.matches(maskTextSelector))
            return true;
        if (el.closest(maskTextSelector))
            return true;
    }
    return false;
}
function onceIframeLoaded(iframeEl, listener, iframeLoadTimeout) {
    var win = iframeEl.contentWindow;
    if (!win) {
        return;
    }
    var fired = false;
    var readyState;
    try {
        readyState = win.document.readyState;
    }
    catch (error) {
        return;
    }
    if (readyState !== 'complete') {
        var timer_1 = setTimeout(function () {
            if (!fired) {
                listener();
                fired = true;
            }
        }, iframeLoadTimeout);
        iframeEl.addEventListener('load', function () {
            clearTimeout(timer_1);
            fired = true;
            listener();
        });
        return;
    }
    var blankUrl = 'about:blank';
    if (win.location.href !== blankUrl ||
        iframeEl.src === blankUrl ||
        iframeEl.src === '') {
        setTimeout(listener, 0);
        return iframeEl.addEventListener('load', listener);
    }
    iframeEl.addEventListener('load', listener);
}
function onceStylesheetLoaded(link, listener, styleSheetLoadTimeout) {
    var fired = false;
    var styleSheetLoaded;
    try {
        styleSheetLoaded = link.sheet;
    }
    catch (error) {
        return;
    }
    if (styleSheetLoaded)
        return;
    var timer = setTimeout(function () {
        if (!fired) {
            listener();
            fired = true;
        }
    }, styleSheetLoadTimeout);
    link.addEventListener('load', function () {
        clearTimeout(timer);
        fired = true;
        listener();
    });
}
function serializeNode(n, options) {
    var doc = options.doc, mirror = options.mirror, blockClass = options.blockClass, blockSelector = options.blockSelector, maskTextClass = options.maskTextClass, maskTextSelector = options.maskTextSelector, inlineStylesheet = options.inlineStylesheet, _a = options.maskInputOptions, maskInputOptions = _a === void 0 ? {} : _a, maskTextFn = options.maskTextFn, maskInputFn = options.maskInputFn, _b = options.dataURLOptions, dataURLOptions = _b === void 0 ? {} : _b, inlineImages = options.inlineImages, recordCanvas = options.recordCanvas, keepIframeSrcFn = options.keepIframeSrcFn, _c = options.newlyAddedElement, newlyAddedElement = _c === void 0 ? false : _c;
    var rootId = getRootId(doc, mirror);
    switch (n.nodeType) {
        case n.DOCUMENT_NODE:
            if (n.compatMode !== 'CSS1Compat') {
                return {
                    type: NodeType.Document,
                    childNodes: [],
                    compatMode: n.compatMode
                };
            }
            else {
                return {
                    type: NodeType.Document,
                    childNodes: []
                };
            }
        case n.DOCUMENT_TYPE_NODE:
            return {
                type: NodeType.DocumentType,
                name: n.name,
                publicId: n.publicId,
                systemId: n.systemId,
                rootId: rootId
            };
        case n.ELEMENT_NODE:
            return serializeElementNode(n, {
                doc: doc,
                blockClass: blockClass,
                blockSelector: blockSelector,
                inlineStylesheet: inlineStylesheet,
                maskInputOptions: maskInputOptions,
                maskInputFn: maskInputFn,
                dataURLOptions: dataURLOptions,
                inlineImages: inlineImages,
                recordCanvas: recordCanvas,
                keepIframeSrcFn: keepIframeSrcFn,
                newlyAddedElement: newlyAddedElement,
                rootId: rootId
            });
        case n.TEXT_NODE:
            return serializeTextNode(n, {
                maskTextClass: maskTextClass,
                maskTextSelector: maskTextSelector,
                maskTextFn: maskTextFn,
                rootId: rootId
            });
        case n.CDATA_SECTION_NODE:
            return {
                type: NodeType.CDATA,
                textContent: '',
                rootId: rootId
            };
        case n.COMMENT_NODE:
            return {
                type: NodeType.Comment,
                textContent: n.textContent || '',
                rootId: rootId
            };
        default:
            return false;
    }
}
function getRootId(doc, mirror) {
    if (!mirror.hasNode(doc))
        return undefined;
    var docId = mirror.getId(doc);
    return docId === 1 ? undefined : docId;
}
function serializeTextNode(n, options) {
    var _a;
    var maskTextClass = options.maskTextClass, maskTextSelector = options.maskTextSelector, maskTextFn = options.maskTextFn, rootId = options.rootId;
    var parentTagName = n.parentNode && n.parentNode.tagName;
    var textContent = n.textContent;
    var isStyle = parentTagName === 'STYLE' ? true : undefined;
    var isScript = parentTagName === 'SCRIPT' ? true : undefined;
    if (isStyle && textContent) {
        try {
            if (n.nextSibling || n.previousSibling) {
            }
            else if ((_a = n.parentNode.sheet) === null || _a === void 0 ? void 0 : _a.cssRules) {
                textContent = stringifyStyleSheet(n.parentNode.sheet);
            }
        }
        catch (err) {
            console.warn("Cannot get CSS styles from text's parentNode. Error: ".concat(err), n);
        }
        textContent = absoluteToStylesheet(textContent, getHref());
    }
    if (isScript) {
        textContent = 'SCRIPT_PLACEHOLDER';
    }
    if (!isStyle &&
        !isScript &&
        textContent &&
        needMaskingText(n, maskTextClass, maskTextSelector)) {
        textContent = maskTextFn
            ? maskTextFn(textContent)
            : textContent.replace(/[\S]/g, '*');
    }
    return {
        type: NodeType.Text,
        textContent: textContent || '',
        isStyle: isStyle,
        rootId: rootId
    };
}
function serializeElementNode(n, options) {
    var doc = options.doc, blockClass = options.blockClass, blockSelector = options.blockSelector, inlineStylesheet = options.inlineStylesheet, _a = options.maskInputOptions, maskInputOptions = _a === void 0 ? {} : _a, maskInputFn = options.maskInputFn, _b = options.dataURLOptions, dataURLOptions = _b === void 0 ? {} : _b, inlineImages = options.inlineImages, recordCanvas = options.recordCanvas, keepIframeSrcFn = options.keepIframeSrcFn, _c = options.newlyAddedElement, newlyAddedElement = _c === void 0 ? false : _c, rootId = options.rootId;
    var needBlock = _isBlockedElement(n, blockClass, blockSelector);
    var tagName = getValidTagName(n);
    var attributes = {};
    var len = n.attributes.length;
    for (var i = 0; i < len; i++) {
        var attr = n.attributes[i];
        attributes[attr.name] = transformAttribute(doc, tagName, attr.name, attr.value);
    }
    if (tagName === 'link' && inlineStylesheet) {
        var stylesheet = Array.from(doc.styleSheets).find(function (s) {
            return s.href === n.href;
        });
        var cssText = null;
        if (stylesheet) {
            cssText = getCssRulesString(stylesheet);
        }
        if (cssText) {
            delete attributes.rel;
            delete attributes.href;
            attributes._cssText = absoluteToStylesheet(cssText, stylesheet.href);
        }
    }
    if (tagName === 'style' &&
        n.sheet &&
        !(n.innerText || n.textContent || '').trim().length) {
        var cssText = getCssRulesString(n.sheet);
        if (cssText) {
            attributes._cssText = absoluteToStylesheet(cssText, getHref());
        }
    }
    if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
        var value = n.value;
        var checked = n.checked;
        if (attributes.type !== 'radio' &&
            attributes.type !== 'checkbox' &&
            attributes.type !== 'submit' &&
            attributes.type !== 'button' &&
            value) {
            attributes.value = maskInputValue({
                type: attributes.type,
                tagName: tagName,
                value: value,
                maskInputOptions: maskInputOptions,
                maskInputFn: maskInputFn
            });
        }
        else if (checked) {
            attributes.checked = checked;
        }
    }
    if (tagName === 'option') {
        if (n.selected && !maskInputOptions['select']) {
            attributes.selected = true;
        }
        else {
            delete attributes.selected;
        }
    }
    if (tagName === 'canvas' && recordCanvas) {
        if (n.__context === '2d') {
            if (!is2DCanvasBlank(n)) {
                attributes.rr_dataURL = n.toDataURL(dataURLOptions.type, dataURLOptions.quality);
            }
        }
        else if (!('__context' in n)) {
            var canvasDataURL = n.toDataURL(dataURLOptions.type, dataURLOptions.quality);
            var blankCanvas = document.createElement('canvas');
            blankCanvas.width = n.width;
            blankCanvas.height = n.height;
            var blankCanvasDataURL = blankCanvas.toDataURL(dataURLOptions.type, dataURLOptions.quality);
            if (canvasDataURL !== blankCanvasDataURL) {
                attributes.rr_dataURL = canvasDataURL;
            }
        }
    }
    if (tagName === 'img' && inlineImages) {
        if (!canvasService) {
            canvasService = doc.createElement('canvas');
            canvasCtx = canvasService.getContext('2d');
        }
        var image_1 = n;
        var oldValue_1 = image_1.crossOrigin;
        image_1.crossOrigin = 'anonymous';
        var recordInlineImage = function () {
            try {
                canvasService.width = image_1.naturalWidth;
                canvasService.height = image_1.naturalHeight;
                canvasCtx.drawImage(image_1, 0, 0);
                attributes.rr_dataURL = canvasService.toDataURL(dataURLOptions.type, dataURLOptions.quality);
            }
            catch (err) {
                console.warn("Cannot inline img src=".concat(image_1.currentSrc, "! Error: ").concat(err));
            }
            oldValue_1
                ? (attributes.crossOrigin = oldValue_1)
                : image_1.removeAttribute('crossorigin');
        };
        if (image_1.complete && image_1.naturalWidth !== 0)
            recordInlineImage();
        else
            image_1.onload = recordInlineImage;
    }
    if (tagName === 'audio' || tagName === 'video') {
        attributes.rr_mediaState = n.paused
            ? 'paused'
            : 'played';
        attributes.rr_mediaCurrentTime = n.currentTime;
    }
    if (!newlyAddedElement) {
        if (n.scrollLeft) {
            attributes.rr_scrollLeft = n.scrollLeft;
        }
        if (n.scrollTop) {
            attributes.rr_scrollTop = n.scrollTop;
        }
    }
    if (needBlock) {
        var _d = n.getBoundingClientRect(), width = _d.width, height = _d.height;
        attributes = {
            "class": attributes["class"],
            rr_width: "".concat(width, "px"),
            rr_height: "".concat(height, "px")
        };
    }
    if (tagName === 'iframe' && !keepIframeSrcFn(attributes.src)) {
        if (!n.contentDocument) {
            attributes.rr_src = attributes.src;
        }
        delete attributes.src;
    }
    return {
        type: NodeType.Element,
        tagName: tagName,
        attributes: attributes,
        childNodes: [],
        isSVG: isSVGElement(n) || undefined,
        needBlock: needBlock,
        rootId: rootId
    };
}
function lowerIfExists(maybeAttr) {
    if (maybeAttr === undefined) {
        return '';
    }
    else {
        return maybeAttr.toLowerCase();
    }
}
function slimDOMExcluded(sn, slimDOMOptions) {
    if (slimDOMOptions.comment && sn.type === NodeType.Comment) {
        return true;
    }
    else if (sn.type === NodeType.Element) {
        if (slimDOMOptions.script &&
            (sn.tagName === 'script' ||
                (sn.tagName === 'link' &&
                    sn.attributes.rel === 'preload' &&
                    sn.attributes.as === 'script') ||
                (sn.tagName === 'link' &&
                    sn.attributes.rel === 'prefetch' &&
                    typeof sn.attributes.href === 'string' &&
                    sn.attributes.href.endsWith('.js')))) {
            return true;
        }
        else if (slimDOMOptions.headFavicon &&
            ((sn.tagName === 'link' && sn.attributes.rel === 'shortcut icon') ||
                (sn.tagName === 'meta' &&
                    (lowerIfExists(sn.attributes.name).match(/^msapplication-tile(image|color)$/) ||
                        lowerIfExists(sn.attributes.name) === 'application-name' ||
                        lowerIfExists(sn.attributes.rel) === 'icon' ||
                        lowerIfExists(sn.attributes.rel) === 'apple-touch-icon' ||
                        lowerIfExists(sn.attributes.rel) === 'shortcut icon')))) {
            return true;
        }
        else if (sn.tagName === 'meta') {
            if (slimDOMOptions.headMetaDescKeywords &&
                lowerIfExists(sn.attributes.name).match(/^description|keywords$/)) {
                return true;
            }
            else if (slimDOMOptions.headMetaSocial &&
                (lowerIfExists(sn.attributes.property).match(/^(og|twitter|fb):/) ||
                    lowerIfExists(sn.attributes.name).match(/^(og|twitter):/) ||
                    lowerIfExists(sn.attributes.name) === 'pinterest')) {
                return true;
            }
            else if (slimDOMOptions.headMetaRobots &&
                (lowerIfExists(sn.attributes.name) === 'robots' ||
                    lowerIfExists(sn.attributes.name) === 'googlebot' ||
                    lowerIfExists(sn.attributes.name) === 'bingbot')) {
                return true;
            }
            else if (slimDOMOptions.headMetaHttpEquiv &&
                sn.attributes['http-equiv'] !== undefined) {
                return true;
            }
            else if (slimDOMOptions.headMetaAuthorship &&
                (lowerIfExists(sn.attributes.name) === 'author' ||
                    lowerIfExists(sn.attributes.name) === 'generator' ||
                    lowerIfExists(sn.attributes.name) === 'framework' ||
                    lowerIfExists(sn.attributes.name) === 'publisher' ||
                    lowerIfExists(sn.attributes.name) === 'progid' ||
                    lowerIfExists(sn.attributes.property).match(/^article:/) ||
                    lowerIfExists(sn.attributes.property).match(/^product:/))) {
                return true;
            }
            else if (slimDOMOptions.headMetaVerification &&
                (lowerIfExists(sn.attributes.name) === 'google-site-verification' ||
                    lowerIfExists(sn.attributes.name) === 'yandex-verification' ||
                    lowerIfExists(sn.attributes.name) === 'csrf-token' ||
                    lowerIfExists(sn.attributes.name) === 'p:domain_verify' ||
                    lowerIfExists(sn.attributes.name) === 'verify-v1' ||
                    lowerIfExists(sn.attributes.name) === 'verification' ||
                    lowerIfExists(sn.attributes.name) === 'shopify-checkout-api-token')) {
                return true;
            }
        }
    }
    return false;
}
function serializeNodeWithId(n, options) {
    var doc = options.doc, mirror = options.mirror, blockClass = options.blockClass, blockSelector = options.blockSelector, maskTextClass = options.maskTextClass, maskTextSelector = options.maskTextSelector, _a = options.skipChild, skipChild = _a === void 0 ? false : _a, _b = options.inlineStylesheet, inlineStylesheet = _b === void 0 ? true : _b, _c = options.maskInputOptions, maskInputOptions = _c === void 0 ? {} : _c, maskTextFn = options.maskTextFn, maskInputFn = options.maskInputFn, slimDOMOptions = options.slimDOMOptions, _d = options.dataURLOptions, dataURLOptions = _d === void 0 ? {} : _d, _e = options.inlineImages, inlineImages = _e === void 0 ? false : _e, _f = options.recordCanvas, recordCanvas = _f === void 0 ? false : _f, onSerialize = options.onSerialize, onIframeLoad = options.onIframeLoad, _g = options.iframeLoadTimeout, iframeLoadTimeout = _g === void 0 ? 5000 : _g, onStylesheetLoad = options.onStylesheetLoad, _h = options.stylesheetLoadTimeout, stylesheetLoadTimeout = _h === void 0 ? 5000 : _h, _j = options.keepIframeSrcFn, keepIframeSrcFn = _j === void 0 ? function () { return false; } : _j, _k = options.newlyAddedElement, newlyAddedElement = _k === void 0 ? false : _k;
    var _l = options.preserveWhiteSpace, preserveWhiteSpace = _l === void 0 ? true : _l;
    var _serializedNode = serializeNode(n, {
        doc: doc,
        mirror: mirror,
        blockClass: blockClass,
        blockSelector: blockSelector,
        maskTextClass: maskTextClass,
        maskTextSelector: maskTextSelector,
        inlineStylesheet: inlineStylesheet,
        maskInputOptions: maskInputOptions,
        maskTextFn: maskTextFn,
        maskInputFn: maskInputFn,
        dataURLOptions: dataURLOptions,
        inlineImages: inlineImages,
        recordCanvas: recordCanvas,
        keepIframeSrcFn: keepIframeSrcFn,
        newlyAddedElement: newlyAddedElement
    });
    if (!_serializedNode) {
        console.warn(n, 'not serialized');
        return null;
    }
    var id;
    if (mirror.hasNode(n)) {
        id = mirror.getId(n);
    }
    else if (slimDOMExcluded(_serializedNode, slimDOMOptions) ||
        (!preserveWhiteSpace &&
            _serializedNode.type === NodeType.Text &&
            !_serializedNode.isStyle &&
            !_serializedNode.textContent.replace(/^\s+|\s+$/gm, '').length)) {
        id = IGNORED_NODE;
    }
    else {
        id = genId();
    }
    var serializedNode = Object.assign(_serializedNode, { id: id });
    mirror.add(n, serializedNode);
    if (id === IGNORED_NODE) {
        return null;
    }
    if (onSerialize) {
        onSerialize(n);
    }
    var recordChild = !skipChild;
    if (serializedNode.type === NodeType.Element) {
        recordChild = recordChild && !serializedNode.needBlock;
        delete serializedNode.needBlock;
        var shadowRoot = n.shadowRoot;
        if (shadowRoot && isNativeShadowDom(shadowRoot))
            serializedNode.isShadowHost = true;
    }
    if ((serializedNode.type === NodeType.Document ||
        serializedNode.type === NodeType.Element) &&
        recordChild) {
        if (slimDOMOptions.headWhitespace &&
            serializedNode.type === NodeType.Element &&
            serializedNode.tagName === 'head') {
            preserveWhiteSpace = false;
        }
        var bypassOptions = {
            doc: doc,
            mirror: mirror,
            blockClass: blockClass,
            blockSelector: blockSelector,
            maskTextClass: maskTextClass,
            maskTextSelector: maskTextSelector,
            skipChild: skipChild,
            inlineStylesheet: inlineStylesheet,
            maskInputOptions: maskInputOptions,
            maskTextFn: maskTextFn,
            maskInputFn: maskInputFn,
            slimDOMOptions: slimDOMOptions,
            dataURLOptions: dataURLOptions,
            inlineImages: inlineImages,
            recordCanvas: recordCanvas,
            preserveWhiteSpace: preserveWhiteSpace,
            onSerialize: onSerialize,
            onIframeLoad: onIframeLoad,
            iframeLoadTimeout: iframeLoadTimeout,
            onStylesheetLoad: onStylesheetLoad,
            stylesheetLoadTimeout: stylesheetLoadTimeout,
            keepIframeSrcFn: keepIframeSrcFn
        };
        for (var _i = 0, _m = Array.from(n.childNodes); _i < _m.length; _i++) {
            var childN = _m[_i];
            var serializedChildNode = serializeNodeWithId(childN, bypassOptions);
            if (serializedChildNode) {
                serializedNode.childNodes.push(serializedChildNode);
            }
        }
        if (isElement(n) && n.shadowRoot) {
            for (var _o = 0, _p = Array.from(n.shadowRoot.childNodes); _o < _p.length; _o++) {
                var childN = _p[_o];
                var serializedChildNode = serializeNodeWithId(childN, bypassOptions);
                if (serializedChildNode) {
                    isNativeShadowDom(n.shadowRoot) &&
                        (serializedChildNode.isShadow = true);
                    serializedNode.childNodes.push(serializedChildNode);
                }
            }
        }
    }
    if (n.parentNode &&
        isShadowRoot(n.parentNode) &&
        isNativeShadowDom(n.parentNode)) {
        serializedNode.isShadow = true;
    }
    if (serializedNode.type === NodeType.Element &&
        serializedNode.tagName === 'iframe') {
        onceIframeLoaded(n, function () {
            var iframeDoc = n.contentDocument;
            if (iframeDoc && onIframeLoad) {
                var serializedIframeNode = serializeNodeWithId(iframeDoc, {
                    doc: iframeDoc,
                    mirror: mirror,
                    blockClass: blockClass,
                    blockSelector: blockSelector,
                    maskTextClass: maskTextClass,
                    maskTextSelector: maskTextSelector,
                    skipChild: false,
                    inlineStylesheet: inlineStylesheet,
                    maskInputOptions: maskInputOptions,
                    maskTextFn: maskTextFn,
                    maskInputFn: maskInputFn,
                    slimDOMOptions: slimDOMOptions,
                    dataURLOptions: dataURLOptions,
                    inlineImages: inlineImages,
                    recordCanvas: recordCanvas,
                    preserveWhiteSpace: preserveWhiteSpace,
                    onSerialize: onSerialize,
                    onIframeLoad: onIframeLoad,
                    iframeLoadTimeout: iframeLoadTimeout,
                    onStylesheetLoad: onStylesheetLoad,
                    stylesheetLoadTimeout: stylesheetLoadTimeout,
                    keepIframeSrcFn: keepIframeSrcFn
                });
                if (serializedIframeNode) {
                    onIframeLoad(n, serializedIframeNode);
                }
            }
        }, iframeLoadTimeout);
    }
    if (serializedNode.type === NodeType.Element &&
        serializedNode.tagName === 'link' &&
        serializedNode.attributes.rel === 'stylesheet') {
        onceStylesheetLoaded(n, function () {
            if (onStylesheetLoad) {
                var serializedLinkNode = serializeNodeWithId(n, {
                    doc: doc,
                    mirror: mirror,
                    blockClass: blockClass,
                    blockSelector: blockSelector,
                    maskTextClass: maskTextClass,
                    maskTextSelector: maskTextSelector,
                    skipChild: false,
                    inlineStylesheet: inlineStylesheet,
                    maskInputOptions: maskInputOptions,
                    maskTextFn: maskTextFn,
                    maskInputFn: maskInputFn,
                    slimDOMOptions: slimDOMOptions,
                    dataURLOptions: dataURLOptions,
                    inlineImages: inlineImages,
                    recordCanvas: recordCanvas,
                    preserveWhiteSpace: preserveWhiteSpace,
                    onSerialize: onSerialize,
                    onIframeLoad: onIframeLoad,
                    iframeLoadTimeout: iframeLoadTimeout,
                    onStylesheetLoad: onStylesheetLoad,
                    stylesheetLoadTimeout: stylesheetLoadTimeout,
                    keepIframeSrcFn: keepIframeSrcFn
                });
                if (serializedLinkNode) {
                    onStylesheetLoad(n, serializedLinkNode);
                }
            }
        }, stylesheetLoadTimeout);
    }
    return serializedNode;
}
function snapshot(n, options) {
    var _a = options || {}, _b = _a.mirror, mirror = _b === void 0 ? new Mirror() : _b, _c = _a.blockClass, blockClass = _c === void 0 ? 'rr-block' : _c, _d = _a.blockSelector, blockSelector = _d === void 0 ? null : _d, _e = _a.maskTextClass, maskTextClass = _e === void 0 ? 'rr-mask' : _e, _f = _a.maskTextSelector, maskTextSelector = _f === void 0 ? null : _f, _g = _a.inlineStylesheet, inlineStylesheet = _g === void 0 ? true : _g, _h = _a.inlineImages, inlineImages = _h === void 0 ? false : _h, _j = _a.recordCanvas, recordCanvas = _j === void 0 ? false : _j, _k = _a.maskAllInputs, maskAllInputs = _k === void 0 ? false : _k, maskTextFn = _a.maskTextFn, maskInputFn = _a.maskInputFn, _l = _a.slimDOM, slimDOM = _l === void 0 ? false : _l, dataURLOptions = _a.dataURLOptions, preserveWhiteSpace = _a.preserveWhiteSpace, onSerialize = _a.onSerialize, onIframeLoad = _a.onIframeLoad, iframeLoadTimeout = _a.iframeLoadTimeout, onStylesheetLoad = _a.onStylesheetLoad, stylesheetLoadTimeout = _a.stylesheetLoadTimeout, _m = _a.keepIframeSrcFn, keepIframeSrcFn = _m === void 0 ? function () { return false; } : _m;
    var maskInputOptions = maskAllInputs === true
        ? {
            color: true,
            date: true,
            'datetime-local': true,
            email: true,
            month: true,
            number: true,
            range: true,
            search: true,
            tel: true,
            text: true,
            time: true,
            url: true,
            week: true,
            textarea: true,
            select: true,
            password: true
        }
        : maskAllInputs === false
            ? {
                password: true
            }
            : maskAllInputs;
    var slimDOMOptions = slimDOM === true || slimDOM === 'all'
        ?
            {
                script: true,
                comment: true,
                headFavicon: true,
                headWhitespace: true,
                headMetaDescKeywords: slimDOM === 'all',
                headMetaSocial: true,
                headMetaRobots: true,
                headMetaHttpEquiv: true,
                headMetaAuthorship: true,
                headMetaVerification: true
            }
        : slimDOM === false
            ? {}
            : slimDOM;
    return serializeNodeWithId(n, {
        doc: n,
        mirror: mirror,
        blockClass: blockClass,
        blockSelector: blockSelector,
        maskTextClass: maskTextClass,
        maskTextSelector: maskTextSelector,
        skipChild: false,
        inlineStylesheet: inlineStylesheet,
        maskInputOptions: maskInputOptions,
        maskTextFn: maskTextFn,
        maskInputFn: maskInputFn,
        slimDOMOptions: slimDOMOptions,
        dataURLOptions: dataURLOptions,
        inlineImages: inlineImages,
        recordCanvas: recordCanvas,
        preserveWhiteSpace: preserveWhiteSpace,
        onSerialize: onSerialize,
        onIframeLoad: onIframeLoad,
        iframeLoadTimeout: iframeLoadTimeout,
        onStylesheetLoad: onStylesheetLoad,
        stylesheetLoadTimeout: stylesheetLoadTimeout,
        keepIframeSrcFn: keepIframeSrcFn,
        newlyAddedElement: false
    });
}

function on(type, fn, target = document) {
    const options = { capture: true, passive: true };
    target.addEventListener(type, fn, options);
    return () => target.removeEventListener(type, fn, options);
}
const DEPARTED_MIRROR_ACCESS_WARNING = 'Please stop import mirror directly. Instead of that,' +
    '\r\n' +
    'now you can use replayer.getMirror() to access the mirror instance of a replayer,' +
    '\r\n' +
    'or you can use record.mirror to access the mirror instance during recording.';
let _mirror = {
    map: {},
    getId() {
        console.error(DEPARTED_MIRROR_ACCESS_WARNING);
        return -1;
    },
    getNode() {
        console.error(DEPARTED_MIRROR_ACCESS_WARNING);
        return null;
    },
    removeNodeFromMap() {
        console.error(DEPARTED_MIRROR_ACCESS_WARNING);
    },
    has() {
        console.error(DEPARTED_MIRROR_ACCESS_WARNING);
        return false;
    },
    reset() {
        console.error(DEPARTED_MIRROR_ACCESS_WARNING);
    },
};
if (typeof window !== 'undefined' && window.Proxy && window.Reflect) {
    _mirror = new Proxy(_mirror, {
        get(target, prop, receiver) {
            if (prop === 'map') {
                console.error(DEPARTED_MIRROR_ACCESS_WARNING);
            }
            return Reflect.get(target, prop, receiver);
        },
    });
}
function throttle(func, wait, options = {}) {
    let timeout = null;
    let previous = 0;
    return function (...args) {
        const now = Date.now();
        if (!previous && options.leading === false) {
            previous = now;
        }
        const remaining = wait - (now - previous);
        const context = this;
        if (remaining <= 0 || remaining > wait) {
            if (timeout) {
                clearTimeout(timeout);
                timeout = null;
            }
            previous = now;
            func.apply(context, args);
        }
        else if (!timeout && options.trailing !== false) {
            timeout = setTimeout(() => {
                previous = options.leading === false ? 0 : Date.now();
                timeout = null;
                func.apply(context, args);
            }, remaining);
        }
    };
}
function hookSetter(target, key, d, isRevoked, win = window) {
    const original = win.Object.getOwnPropertyDescriptor(target, key);
    win.Object.defineProperty(target, key, isRevoked
        ? d
        : {
            set(value) {
                setTimeout(() => {
                    d.set.call(this, value);
                }, 0);
                if (original && original.set) {
                    original.set.call(this, value);
                }
            },
        });
    return () => hookSetter(target, key, original || {}, true);
}
function patch(source, name, replacement) {
    try {
        if (!(name in source)) {
            return () => {
            };
        }
        const original = source[name];
        const wrapped = replacement(original);
        if (typeof wrapped === 'function') {
            wrapped.prototype = wrapped.prototype || {};
            Object.defineProperties(wrapped, {
                __rrweb_original__: {
                    enumerable: false,
                    value: original,
                },
            });
        }
        source[name] = wrapped;
        return () => {
            source[name] = original;
        };
    }
    catch (_a) {
        return () => {
        };
    }
}
function getWindowHeight() {
    return (window.innerHeight ||
        (document.documentElement && document.documentElement.clientHeight) ||
        (document.body && document.body.clientHeight));
}
function getWindowWidth() {
    return (window.innerWidth ||
        (document.documentElement && document.documentElement.clientWidth) ||
        (document.body && document.body.clientWidth));
}
function isBlocked(node, blockClass, blockSelector, checkAncestors) {
    if (!node) {
        return false;
    }
    const el = node.nodeType === node.ELEMENT_NODE
        ? node
        : node.parentElement;
    if (!el)
        return false;
    if (typeof blockClass === 'string') {
        if (el.classList.contains(blockClass))
            return true;
        if (checkAncestors && el.closest('.' + blockClass) !== null)
            return true;
    }
    else {
        if (classMatchesRegex(el, blockClass, checkAncestors))
            return true;
    }
    if (blockSelector) {
        if (node.matches(blockSelector))
            return true;
        if (checkAncestors && el.closest(blockSelector) !== null)
            return true;
    }
    return false;
}
function isSerialized(n, mirror) {
    return mirror.getId(n) !== -1;
}
function isIgnored(n, mirror) {
    return mirror.getId(n) === IGNORED_NODE;
}
function isAncestorRemoved(target, mirror) {
    if (isShadowRoot(target)) {
        return false;
    }
    const id = mirror.getId(target);
    if (!mirror.has(id)) {
        return true;
    }
    if (target.parentNode &&
        target.parentNode.nodeType === target.DOCUMENT_NODE) {
        return false;
    }
    if (!target.parentNode) {
        return true;
    }
    return isAncestorRemoved(target.parentNode, mirror);
}
function isTouchEvent(event) {
    return Boolean(event.changedTouches);
}
function polyfill(win = window) {
    if ('NodeList' in win && !win.NodeList.prototype.forEach) {
        win.NodeList.prototype.forEach = Array.prototype
            .forEach;
    }
    if ('DOMTokenList' in win && !win.DOMTokenList.prototype.forEach) {
        win.DOMTokenList.prototype.forEach = Array.prototype
            .forEach;
    }
    if (!Node.prototype.contains) {
        Node.prototype.contains = (...args) => {
            let node = args[0];
            if (!(0 in args)) {
                throw new TypeError('1 argument is required');
            }
            do {
                if (this === node) {
                    return true;
                }
            } while ((node = node && node.parentNode));
            return false;
        };
    }
}
function isSerializedIframe(n, mirror) {
    return Boolean(n.nodeName === 'IFRAME' && mirror.getMeta(n));
}
function isSerializedStylesheet(n, mirror) {
    return Boolean(n.nodeName === 'LINK' &&
        n.nodeType === n.ELEMENT_NODE &&
        n.getAttribute &&
        n.getAttribute('rel') === 'stylesheet' &&
        mirror.getMeta(n));
}
function hasShadowRoot(n) {
    return Boolean(n === null || n === void 0 ? void 0 : n.shadowRoot);
}
class StyleSheetMirror {
    constructor() {
        this.id = 1;
        this.styleIDMap = new WeakMap();
        this.idStyleMap = new Map();
    }
    getId(stylesheet) {
        var _a;
        return (_a = this.styleIDMap.get(stylesheet)) !== null && _a !== void 0 ? _a : -1;
    }
    has(stylesheet) {
        return this.styleIDMap.has(stylesheet);
    }
    add(stylesheet, id) {
        if (this.has(stylesheet))
            return this.getId(stylesheet);
        let newId;
        if (id === undefined) {
            newId = this.id++;
        }
        else
            newId = id;
        this.styleIDMap.set(stylesheet, newId);
        this.idStyleMap.set(newId, stylesheet);
        return newId;
    }
    getStyle(id) {
        return this.idStyleMap.get(id) || null;
    }
    reset() {
        this.styleIDMap = new WeakMap();
        this.idStyleMap = new Map();
        this.id = 1;
    }
    generateId() {
        return this.id++;
    }
}

var EventType = /* @__PURE__ */ ((EventType2) => {
  EventType2[EventType2["DomContentLoaded"] = 0] = "DomContentLoaded";
  EventType2[EventType2["Load"] = 1] = "Load";
  EventType2[EventType2["FullSnapshot"] = 2] = "FullSnapshot";
  EventType2[EventType2["IncrementalSnapshot"] = 3] = "IncrementalSnapshot";
  EventType2[EventType2["Meta"] = 4] = "Meta";
  EventType2[EventType2["Custom"] = 5] = "Custom";
  EventType2[EventType2["Plugin"] = 6] = "Plugin";
  return EventType2;
})(EventType || {});
var IncrementalSource = /* @__PURE__ */ ((IncrementalSource2) => {
  IncrementalSource2[IncrementalSource2["Mutation"] = 0] = "Mutation";
  IncrementalSource2[IncrementalSource2["MouseMove"] = 1] = "MouseMove";
  IncrementalSource2[IncrementalSource2["MouseInteraction"] = 2] = "MouseInteraction";
  IncrementalSource2[IncrementalSource2["Scroll"] = 3] = "Scroll";
  IncrementalSource2[IncrementalSource2["ViewportResize"] = 4] = "ViewportResize";
  IncrementalSource2[IncrementalSource2["Input"] = 5] = "Input";
  IncrementalSource2[IncrementalSource2["TouchMove"] = 6] = "TouchMove";
  IncrementalSource2[IncrementalSource2["MediaInteraction"] = 7] = "MediaInteraction";
  IncrementalSource2[IncrementalSource2["StyleSheetRule"] = 8] = "StyleSheetRule";
  IncrementalSource2[IncrementalSource2["CanvasMutation"] = 9] = "CanvasMutation";
  IncrementalSource2[IncrementalSource2["Font"] = 10] = "Font";
  IncrementalSource2[IncrementalSource2["Log"] = 11] = "Log";
  IncrementalSource2[IncrementalSource2["Drag"] = 12] = "Drag";
  IncrementalSource2[IncrementalSource2["StyleDeclaration"] = 13] = "StyleDeclaration";
  IncrementalSource2[IncrementalSource2["Selection"] = 14] = "Selection";
  IncrementalSource2[IncrementalSource2["AdoptedStyleSheet"] = 15] = "AdoptedStyleSheet";
  return IncrementalSource2;
})(IncrementalSource || {});
var MouseInteractions = /* @__PURE__ */ ((MouseInteractions2) => {
  MouseInteractions2[MouseInteractions2["MouseUp"] = 0] = "MouseUp";
  MouseInteractions2[MouseInteractions2["MouseDown"] = 1] = "MouseDown";
  MouseInteractions2[MouseInteractions2["Click"] = 2] = "Click";
  MouseInteractions2[MouseInteractions2["ContextMenu"] = 3] = "ContextMenu";
  MouseInteractions2[MouseInteractions2["DblClick"] = 4] = "DblClick";
  MouseInteractions2[MouseInteractions2["Focus"] = 5] = "Focus";
  MouseInteractions2[MouseInteractions2["Blur"] = 6] = "Blur";
  MouseInteractions2[MouseInteractions2["TouchStart"] = 7] = "TouchStart";
  MouseInteractions2[MouseInteractions2["TouchMove_Departed"] = 8] = "TouchMove_Departed";
  MouseInteractions2[MouseInteractions2["TouchEnd"] = 9] = "TouchEnd";
  MouseInteractions2[MouseInteractions2["TouchCancel"] = 10] = "TouchCancel";
  return MouseInteractions2;
})(MouseInteractions || {});
var CanvasContext = /* @__PURE__ */ ((CanvasContext2) => {
  CanvasContext2[CanvasContext2["2D"] = 0] = "2D";
  CanvasContext2[CanvasContext2["WebGL"] = 1] = "WebGL";
  CanvasContext2[CanvasContext2["WebGL2"] = 2] = "WebGL2";
  return CanvasContext2;
})(CanvasContext || {});

function isNodeInLinkedList(n) {
    return '__ln' in n;
}
class DoubleLinkedList {
    constructor() {
        this.length = 0;
        this.head = null;
    }
    get(position) {
        if (position >= this.length) {
            throw new Error('Position outside of list range');
        }
        let current = this.head;
        for (let index = 0; index < position; index++) {
            current = (current === null || current === void 0 ? void 0 : current.next) || null;
        }
        return current;
    }
    addNode(n) {
        const node = {
            value: n,
            previous: null,
            next: null,
        };
        n.__ln = node;
        if (n.previousSibling && isNodeInLinkedList(n.previousSibling)) {
            const current = n.previousSibling.__ln.next;
            node.next = current;
            node.previous = n.previousSibling.__ln;
            n.previousSibling.__ln.next = node;
            if (current) {
                current.previous = node;
            }
        }
        else if (n.nextSibling &&
            isNodeInLinkedList(n.nextSibling) &&
            n.nextSibling.__ln.previous) {
            const current = n.nextSibling.__ln.previous;
            node.previous = current;
            node.next = n.nextSibling.__ln;
            n.nextSibling.__ln.previous = node;
            if (current) {
                current.next = node;
            }
        }
        else {
            if (this.head) {
                this.head.previous = node;
            }
            node.next = this.head;
            this.head = node;
        }
        this.length++;
    }
    removeNode(n) {
        const current = n.__ln;
        if (!this.head) {
            return;
        }
        if (!current.previous) {
            this.head = current.next;
            if (this.head) {
                this.head.previous = null;
            }
        }
        else {
            current.previous.next = current.next;
            if (current.next) {
                current.next.previous = current.previous;
            }
        }
        if (n.__ln) {
            delete n.__ln;
        }
        this.length--;
    }
}
const moveKey = (id, parentId) => `${id}@${parentId}`;
class MutationBuffer {
    constructor() {
        this.frozen = false;
        this.locked = false;
        this.texts = [];
        this.attributes = [];
        this.removes = [];
        this.mapRemoves = [];
        this.movedMap = {};
        this.addedSet = new Set();
        this.movedSet = new Set();
        this.droppedSet = new Set();
        this.processMutations = (mutations) => {
            mutations.forEach(this.processMutation);
            this.emit();
        };
        this.emit = () => {
            if (this.frozen || this.locked) {
                return;
            }
            const adds = [];
            const addList = new DoubleLinkedList();
            const getNextId = (n) => {
                let ns = n;
                let nextId = IGNORED_NODE;
                while (nextId === IGNORED_NODE) {
                    ns = ns && ns.nextSibling;
                    nextId = ns && this.mirror.getId(ns);
                }
                return nextId;
            };
            const pushAdd = (n) => {
                var _a, _b, _c, _d;
                let shadowHost = null;
                if (((_b = (_a = n.getRootNode) === null || _a === void 0 ? void 0 : _a.call(n)) === null || _b === void 0 ? void 0 : _b.nodeType) === Node.DOCUMENT_FRAGMENT_NODE &&
                    n.getRootNode().host)
                    shadowHost = n.getRootNode().host;
                let rootShadowHost = shadowHost;
                while (((_d = (_c = rootShadowHost === null || rootShadowHost === void 0 ? void 0 : rootShadowHost.getRootNode) === null || _c === void 0 ? void 0 : _c.call(rootShadowHost)) === null || _d === void 0 ? void 0 : _d.nodeType) ===
                    Node.DOCUMENT_FRAGMENT_NODE &&
                    rootShadowHost.getRootNode().host)
                    rootShadowHost = rootShadowHost.getRootNode().host;
                const notInDoc = !this.doc.contains(n) &&
                    (!rootShadowHost || !this.doc.contains(rootShadowHost));
                if (!n.parentNode || notInDoc) {
                    return;
                }
                const parentId = isShadowRoot(n.parentNode)
                    ? this.mirror.getId(shadowHost)
                    : this.mirror.getId(n.parentNode);
                const nextId = getNextId(n);
                if (parentId === -1 || nextId === -1) {
                    return addList.addNode(n);
                }
                const sn = serializeNodeWithId(n, {
                    doc: this.doc,
                    mirror: this.mirror,
                    blockClass: this.blockClass,
                    blockSelector: this.blockSelector,
                    maskTextClass: this.maskTextClass,
                    maskTextSelector: this.maskTextSelector,
                    skipChild: true,
                    newlyAddedElement: true,
                    inlineStylesheet: this.inlineStylesheet,
                    maskInputOptions: this.maskInputOptions,
                    maskTextFn: this.maskTextFn,
                    maskInputFn: this.maskInputFn,
                    slimDOMOptions: this.slimDOMOptions,
                    dataURLOptions: this.dataURLOptions,
                    recordCanvas: this.recordCanvas,
                    inlineImages: this.inlineImages,
                    onSerialize: (currentN) => {
                        if (isSerializedIframe(currentN, this.mirror)) {
                            this.iframeManager.addIframe(currentN);
                        }
                        if (isSerializedStylesheet(currentN, this.mirror)) {
                            this.stylesheetManager.trackLinkElement(currentN);
                        }
                        if (hasShadowRoot(n)) {
                            this.shadowDomManager.addShadowRoot(n.shadowRoot, this.doc);
                        }
                    },
                    onIframeLoad: (iframe, childSn) => {
                        this.iframeManager.attachIframe(iframe, childSn);
                        this.shadowDomManager.observeAttachShadow(iframe);
                    },
                    onStylesheetLoad: (link, childSn) => {
                        this.stylesheetManager.attachLinkElement(link, childSn);
                    },
                });
                if (sn) {
                    adds.push({
                        parentId,
                        nextId,
                        node: sn,
                    });
                }
            };
            while (this.mapRemoves.length) {
                this.mirror.removeNodeFromMap(this.mapRemoves.shift());
            }
            for (const n of Array.from(this.movedSet.values())) {
                if (isParentRemoved(this.removes, n, this.mirror) &&
                    !this.movedSet.has(n.parentNode)) {
                    continue;
                }
                pushAdd(n);
            }
            for (const n of Array.from(this.addedSet.values())) {
                if (!isAncestorInSet(this.droppedSet, n) &&
                    !isParentRemoved(this.removes, n, this.mirror)) {
                    pushAdd(n);
                }
                else if (isAncestorInSet(this.movedSet, n)) {
                    pushAdd(n);
                }
                else {
                    this.droppedSet.add(n);
                }
            }
            let candidate = null;
            while (addList.length) {
                let node = null;
                if (candidate) {
                    const parentId = this.mirror.getId(candidate.value.parentNode);
                    const nextId = getNextId(candidate.value);
                    if (parentId !== -1 && nextId !== -1) {
                        node = candidate;
                    }
                }
                if (!node) {
                    for (let index = addList.length - 1; index >= 0; index--) {
                        const _node = addList.get(index);
                        if (_node) {
                            const parentId = this.mirror.getId(_node.value.parentNode);
                            const nextId = getNextId(_node.value);
                            if (nextId === -1)
                                continue;
                            else if (parentId !== -1) {
                                node = _node;
                                break;
                            }
                            else {
                                const unhandledNode = _node.value;
                                if (unhandledNode.parentNode &&
                                    unhandledNode.parentNode.nodeType ===
                                        Node.DOCUMENT_FRAGMENT_NODE) {
                                    const shadowHost = unhandledNode.parentNode
                                        .host;
                                    const parentId = this.mirror.getId(shadowHost);
                                    if (parentId !== -1) {
                                        node = _node;
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
                if (!node) {
                    while (addList.head) {
                        addList.removeNode(addList.head.value);
                    }
                    break;
                }
                candidate = node.previous;
                addList.removeNode(node.value);
                pushAdd(node.value);
            }
            const payload = {
                texts: this.texts
                    .map((text) => ({
                    id: this.mirror.getId(text.node),
                    value: text.value,
                }))
                    .filter((text) => this.mirror.has(text.id)),
                attributes: this.attributes
                    .map((attribute) => ({
                    id: this.mirror.getId(attribute.node),
                    attributes: attribute.attributes,
                }))
                    .filter((attribute) => this.mirror.has(attribute.id)),
                removes: this.removes,
                adds,
            };
            if (!payload.texts.length &&
                !payload.attributes.length &&
                !payload.removes.length &&
                !payload.adds.length) {
                return;
            }
            this.texts = [];
            this.attributes = [];
            this.removes = [];
            this.addedSet = new Set();
            this.movedSet = new Set();
            this.droppedSet = new Set();
            this.movedMap = {};
            this.mutationCb(payload);
        };
        this.processMutation = (m) => {
            if (isIgnored(m.target, this.mirror)) {
                return;
            }
            switch (m.type) {
                case 'characterData': {
                    const value = m.target.textContent;
                    if (!isBlocked(m.target, this.blockClass, this.blockSelector, false) &&
                        value !== m.oldValue) {
                        this.texts.push({
                            value: needMaskingText(m.target, this.maskTextClass, this.maskTextSelector) && value
                                ? this.maskTextFn
                                    ? this.maskTextFn(value)
                                    : value.replace(/[\S]/g, '*')
                                : value,
                            node: m.target,
                        });
                    }
                    break;
                }
                case 'attributes': {
                    const target = m.target;
                    let value = m.target.getAttribute(m.attributeName);
                    if (m.attributeName === 'value') {
                        value = maskInputValue({
                            maskInputOptions: this.maskInputOptions,
                            tagName: m.target.tagName,
                            type: m.target.getAttribute('type'),
                            value,
                            maskInputFn: this.maskInputFn,
                        });
                    }
                    if (isBlocked(m.target, this.blockClass, this.blockSelector, false) ||
                        value === m.oldValue) {
                        return;
                    }
                    let item = this.attributes.find((a) => a.node === m.target);
                    if (target.tagName === 'IFRAME' &&
                        m.attributeName === 'src' &&
                        !this.keepIframeSrcFn(value)) {
                        if (!target.contentDocument) {
                            m.attributeName = 'rr_src';
                        }
                        else {
                            return;
                        }
                    }
                    if (!item) {
                        item = {
                            node: m.target,
                            attributes: {},
                        };
                        this.attributes.push(item);
                    }
                    if (m.attributeName === 'style') {
                        const old = this.doc.createElement('span');
                        if (m.oldValue) {
                            old.setAttribute('style', m.oldValue);
                        }
                        if (item.attributes.style === undefined ||
                            item.attributes.style === null) {
                            item.attributes.style = {};
                        }
                        const styleObj = item.attributes.style;
                        for (const pname of Array.from(target.style)) {
                            const newValue = target.style.getPropertyValue(pname);
                            const newPriority = target.style.getPropertyPriority(pname);
                            if (newValue !== old.style.getPropertyValue(pname) ||
                                newPriority !== old.style.getPropertyPriority(pname)) {
                                if (newPriority === '') {
                                    styleObj[pname] = newValue;
                                }
                                else {
                                    styleObj[pname] = [newValue, newPriority];
                                }
                            }
                        }
                        for (const pname of Array.from(old.style)) {
                            if (target.style.getPropertyValue(pname) === '') {
                                styleObj[pname] = false;
                            }
                        }
                    }
                    else {
                        item.attributes[m.attributeName] = transformAttribute(this.doc, target.tagName, m.attributeName, value);
                    }
                    break;
                }
                case 'childList': {
                    if (isBlocked(m.target, this.blockClass, this.blockSelector, true))
                        return;
                    m.addedNodes.forEach((n) => this.genAdds(n, m.target));
                    m.removedNodes.forEach((n) => {
                        const nodeId = this.mirror.getId(n);
                        const parentId = isShadowRoot(m.target)
                            ? this.mirror.getId(m.target.host)
                            : this.mirror.getId(m.target);
                        if (isBlocked(m.target, this.blockClass, this.blockSelector, false) ||
                            isIgnored(n, this.mirror) ||
                            !isSerialized(n, this.mirror)) {
                            return;
                        }
                        if (this.addedSet.has(n)) {
                            deepDelete(this.addedSet, n);
                            this.droppedSet.add(n);
                        }
                        else if (this.addedSet.has(m.target) && nodeId === -1) ;
                        else if (isAncestorRemoved(m.target, this.mirror)) ;
                        else if (this.movedSet.has(n) &&
                            this.movedMap[moveKey(nodeId, parentId)]) {
                            deepDelete(this.movedSet, n);
                        }
                        else {
                            this.removes.push({
                                parentId,
                                id: nodeId,
                                isShadow: isShadowRoot(m.target) && isNativeShadowDom(m.target)
                                    ? true
                                    : undefined,
                            });
                        }
                        this.mapRemoves.push(n);
                    });
                    break;
                }
            }
        };
        this.genAdds = (n, target) => {
            if (this.mirror.hasNode(n)) {
                if (isIgnored(n, this.mirror)) {
                    return;
                }
                this.movedSet.add(n);
                let targetId = null;
                if (target && this.mirror.hasNode(target)) {
                    targetId = this.mirror.getId(target);
                }
                if (targetId && targetId !== -1) {
                    this.movedMap[moveKey(this.mirror.getId(n), targetId)] = true;
                }
            }
            else {
                this.addedSet.add(n);
                this.droppedSet.delete(n);
            }
            if (!isBlocked(n, this.blockClass, this.blockSelector, false))
                n.childNodes.forEach((childN) => this.genAdds(childN));
        };
    }
    init(options) {
        [
            'mutationCb',
            'blockClass',
            'blockSelector',
            'maskTextClass',
            'maskTextSelector',
            'inlineStylesheet',
            'maskInputOptions',
            'maskTextFn',
            'maskInputFn',
            'keepIframeSrcFn',
            'recordCanvas',
            'inlineImages',
            'slimDOMOptions',
            'dataURLOptions',
            'doc',
            'mirror',
            'iframeManager',
            'stylesheetManager',
            'shadowDomManager',
            'canvasManager',
        ].forEach((key) => {
            this[key] = options[key];
        });
    }
    freeze() {
        this.frozen = true;
        this.canvasManager.freeze();
    }
    unfreeze() {
        this.frozen = false;
        this.canvasManager.unfreeze();
        this.emit();
    }
    isFrozen() {
        return this.frozen;
    }
    lock() {
        this.locked = true;
        this.canvasManager.lock();
    }
    unlock() {
        this.locked = false;
        this.canvasManager.unlock();
        this.emit();
    }
    reset() {
        this.shadowDomManager.reset();
        this.canvasManager.reset();
    }
}
function deepDelete(addsSet, n) {
    addsSet.delete(n);
    n.childNodes.forEach((childN) => deepDelete(addsSet, childN));
}
function isParentRemoved(removes, n, mirror) {
    if (removes.length === 0)
        return false;
    return _isParentRemoved(removes, n, mirror);
}
function _isParentRemoved(removes, n, mirror) {
    const { parentNode } = n;
    if (!parentNode) {
        return false;
    }
    const parentId = mirror.getId(parentNode);
    if (removes.some((r) => r.id === parentId)) {
        return true;
    }
    return _isParentRemoved(removes, parentNode, mirror);
}
function isAncestorInSet(set, n) {
    if (set.size === 0)
        return false;
    return _isAncestorInSet(set, n);
}
function _isAncestorInSet(set, n) {
    const { parentNode } = n;
    if (!parentNode) {
        return false;
    }
    if (set.has(parentNode)) {
        return true;
    }
    return _isAncestorInSet(set, parentNode);
}

const mutationBuffers = [];
const isCSSGroupingRuleSupported = typeof CSSGroupingRule !== 'undefined';
const isCSSMediaRuleSupported = typeof CSSMediaRule !== 'undefined';
const isCSSSupportsRuleSupported = typeof CSSSupportsRule !== 'undefined';
const isCSSConditionRuleSupported = typeof CSSConditionRule !== 'undefined';
function getEventTarget(event) {
    try {
        if ('composedPath' in event) {
            const path = event.composedPath();
            if (path.length) {
                return path[0];
            }
        }
        else if ('path' in event && event.path.length) {
            return event.path[0];
        }
        return event.target;
    }
    catch (_a) {
        return event.target;
    }
}
function initMutationObserver(options, rootEl) {
    var _a, _b;
    const mutationBuffer = new MutationBuffer();
    mutationBuffers.push(mutationBuffer);
    mutationBuffer.init(options);
    let mutationObserverCtor = window.MutationObserver ||
        window.__rrMutationObserver;
    const angularZoneSymbol = (_b = (_a = window === null || window === void 0 ? void 0 : window.Zone) === null || _a === void 0 ? void 0 : _a.__symbol__) === null || _b === void 0 ? void 0 : _b.call(_a, 'MutationObserver');
    if (angularZoneSymbol &&
        window[angularZoneSymbol]) {
        mutationObserverCtor = window[angularZoneSymbol];
    }
    const observer = new mutationObserverCtor(mutationBuffer.processMutations.bind(mutationBuffer));
    observer.observe(rootEl, {
        attributes: true,
        attributeOldValue: true,
        characterData: true,
        characterDataOldValue: true,
        childList: true,
        subtree: true,
    });
    return observer;
}
function initMoveObserver({ mousemoveCb, sampling, doc, mirror, }) {
    if (sampling.mousemove === false) {
        return () => {
        };
    }
    const threshold = typeof sampling.mousemove === 'number' ? sampling.mousemove : 50;
    const callbackThreshold = typeof sampling.mousemoveCallback === 'number'
        ? sampling.mousemoveCallback
        : 500;
    let positions = [];
    let timeBaseline;
    const wrappedCb = throttle((source) => {
        const totalOffset = Date.now() - timeBaseline;
        mousemoveCb(positions.map((p) => {
            p.timeOffset -= totalOffset;
            return p;
        }), source);
        positions = [];
        timeBaseline = null;
    }, callbackThreshold);
    const updatePosition = throttle((evt) => {
        const target = getEventTarget(evt);
        const { clientX, clientY } = isTouchEvent(evt)
            ? evt.changedTouches[0]
            : evt;
        if (!timeBaseline) {
            timeBaseline = Date.now();
        }
        positions.push({
            x: clientX,
            y: clientY,
            id: mirror.getId(target),
            timeOffset: Date.now() - timeBaseline,
        });
        wrappedCb(typeof DragEvent !== 'undefined' && evt instanceof DragEvent
            ? IncrementalSource.Drag
            : evt instanceof MouseEvent
                ? IncrementalSource.MouseMove
                : IncrementalSource.TouchMove);
    }, threshold, {
        trailing: false,
    });
    const handlers = [
        on('mousemove', updatePosition, doc),
        on('touchmove', updatePosition, doc),
        on('drag', updatePosition, doc),
    ];
    return () => {
        handlers.forEach((h) => h());
    };
}
function initMouseInteractionObserver({ mouseInteractionCb, doc, mirror, blockClass, blockSelector, sampling, }) {
    if (sampling.mouseInteraction === false) {
        return () => {
        };
    }
    const disableMap = sampling.mouseInteraction === true ||
        sampling.mouseInteraction === undefined
        ? {}
        : sampling.mouseInteraction;
    const handlers = [];
    const getHandler = (eventKey) => {
        return (event) => {
            const target = getEventTarget(event);
            if (isBlocked(target, blockClass, blockSelector, true)) {
                return;
            }
            const e = isTouchEvent(event) ? event.changedTouches[0] : event;
            if (!e) {
                return;
            }
            const id = mirror.getId(target);
            const { clientX, clientY } = e;
            mouseInteractionCb({
                type: MouseInteractions[eventKey],
                id,
                x: clientX,
                y: clientY,
            });
        };
    };
    Object.keys(MouseInteractions)
        .filter((key) => Number.isNaN(Number(key)) &&
        !key.endsWith('_Departed') &&
        disableMap[key] !== false)
        .forEach((eventKey) => {
        const eventName = eventKey.toLowerCase();
        const handler = getHandler(eventKey);
        handlers.push(on(eventName, handler, doc));
    });
    return () => {
        handlers.forEach((h) => h());
    };
}
function initScrollObserver({ scrollCb, doc, mirror, blockClass, blockSelector, sampling, }) {
    const updatePosition = throttle((evt) => {
        const target = getEventTarget(evt);
        if (!target || isBlocked(target, blockClass, blockSelector, true)) {
            return;
        }
        const id = mirror.getId(target);
        if (target === doc) {
            const scrollEl = (doc.scrollingElement || doc.documentElement);
            scrollCb({
                id,
                x: scrollEl.scrollLeft,
                y: scrollEl.scrollTop,
            });
        }
        else {
            scrollCb({
                id,
                x: target.scrollLeft,
                y: target.scrollTop,
            });
        }
    }, sampling.scroll || 100);
    return on('scroll', updatePosition, doc);
}
function initViewportResizeObserver({ viewportResizeCb, }) {
    let lastH = -1;
    let lastW = -1;
    const updateDimension = throttle(() => {
        const height = getWindowHeight();
        const width = getWindowWidth();
        if (lastH !== height || lastW !== width) {
            viewportResizeCb({
                width: Number(width),
                height: Number(height),
            });
            lastH = height;
            lastW = width;
        }
    }, 200);
    return on('resize', updateDimension, window);
}
function wrapEventWithUserTriggeredFlag(v, enable) {
    const value = Object.assign({}, v);
    if (!enable)
        delete value.userTriggered;
    return value;
}
const INPUT_TAGS = ['INPUT', 'TEXTAREA', 'SELECT'];
const lastInputValueMap = new WeakMap();
function initInputObserver({ inputCb, doc, mirror, blockClass, blockSelector, ignoreClass, maskInputOptions, maskInputFn, sampling, userTriggeredOnInput, }) {
    function eventHandler(event) {
        let target = getEventTarget(event);
        const userTriggered = event.isTrusted;
        if (target && target.tagName === 'OPTION')
            target = target.parentElement;
        if (!target ||
            !target.tagName ||
            INPUT_TAGS.indexOf(target.tagName) < 0 ||
            isBlocked(target, blockClass, blockSelector, true)) {
            return;
        }
        const type = target.type;
        if (target.classList.contains(ignoreClass)) {
            return;
        }
        let text = target.value;
        let isChecked = false;
        if (type === 'radio' || type === 'checkbox') {
            isChecked = target.checked;
        }
        else if (maskInputOptions[target.tagName.toLowerCase()] ||
            maskInputOptions[type]) {
            text = maskInputValue({
                maskInputOptions,
                tagName: target.tagName,
                type,
                value: text,
                maskInputFn,
            });
        }
        cbWithDedup(target, wrapEventWithUserTriggeredFlag({ text, isChecked, userTriggered }, userTriggeredOnInput));
        const name = target.name;
        if (type === 'radio' && name && isChecked) {
            doc
                .querySelectorAll(`input[type="radio"][name="${name}"]`)
                .forEach((el) => {
                if (el !== target) {
                    cbWithDedup(el, wrapEventWithUserTriggeredFlag({
                        text: el.value,
                        isChecked: !isChecked,
                        userTriggered: false,
                    }, userTriggeredOnInput));
                }
            });
        }
    }
    function cbWithDedup(target, v) {
        const lastInputValue = lastInputValueMap.get(target);
        if (!lastInputValue ||
            lastInputValue.text !== v.text ||
            lastInputValue.isChecked !== v.isChecked) {
            lastInputValueMap.set(target, v);
            const id = mirror.getId(target);
            inputCb(Object.assign(Object.assign({}, v), { id }));
        }
    }
    const events = sampling.input === 'last' ? ['change'] : ['input', 'change'];
    const handlers = events.map((eventName) => on(eventName, eventHandler, doc));
    const currentWindow = doc.defaultView;
    if (!currentWindow) {
        return () => {
            handlers.forEach((h) => h());
        };
    }
    const propertyDescriptor = currentWindow.Object.getOwnPropertyDescriptor(currentWindow.HTMLInputElement.prototype, 'value');
    const hookProperties = [
        [currentWindow.HTMLInputElement.prototype, 'value'],
        [currentWindow.HTMLInputElement.prototype, 'checked'],
        [currentWindow.HTMLSelectElement.prototype, 'value'],
        [currentWindow.HTMLTextAreaElement.prototype, 'value'],
        [currentWindow.HTMLSelectElement.prototype, 'selectedIndex'],
        [currentWindow.HTMLOptionElement.prototype, 'selected'],
    ];
    if (propertyDescriptor && propertyDescriptor.set) {
        handlers.push(...hookProperties.map((p) => hookSetter(p[0], p[1], {
            set() {
                eventHandler({ target: this });
            },
        }, false, currentWindow)));
    }
    return () => {
        handlers.forEach((h) => h());
    };
}
function getNestedCSSRulePositions(rule) {
    const positions = [];
    function recurse(childRule, pos) {
        if ((isCSSGroupingRuleSupported &&
            childRule.parentRule instanceof CSSGroupingRule) ||
            (isCSSMediaRuleSupported &&
                childRule.parentRule instanceof CSSMediaRule) ||
            (isCSSSupportsRuleSupported &&
                childRule.parentRule instanceof CSSSupportsRule) ||
            (isCSSConditionRuleSupported &&
                childRule.parentRule instanceof CSSConditionRule)) {
            const rules = Array.from(childRule.parentRule.cssRules);
            const index = rules.indexOf(childRule);
            pos.unshift(index);
        }
        else if (childRule.parentStyleSheet) {
            const rules = Array.from(childRule.parentStyleSheet.cssRules);
            const index = rules.indexOf(childRule);
            pos.unshift(index);
        }
        return pos;
    }
    return recurse(rule, positions);
}
function getIdAndStyleId(sheet, mirror, styleMirror) {
    let id, styleId;
    if (!sheet)
        return {};
    if (sheet.ownerNode)
        id = mirror.getId(sheet.ownerNode);
    else
        styleId = styleMirror.getId(sheet);
    return {
        styleId,
        id,
    };
}
function initStyleSheetObserver({ styleSheetRuleCb, mirror, stylesheetManager }, { win }) {
    const insertRule = win.CSSStyleSheet.prototype.insertRule;
    win.CSSStyleSheet.prototype.insertRule = function (rule, index) {
        const { id, styleId } = getIdAndStyleId(this, mirror, stylesheetManager.styleMirror);
        if ((id && id !== -1) || (styleId && styleId !== -1)) {
            styleSheetRuleCb({
                id,
                styleId,
                adds: [{ rule, index }],
            });
        }
        return insertRule.apply(this, [rule, index]);
    };
    const deleteRule = win.CSSStyleSheet.prototype.deleteRule;
    win.CSSStyleSheet.prototype.deleteRule = function (index) {
        const { id, styleId } = getIdAndStyleId(this, mirror, stylesheetManager.styleMirror);
        if ((id && id !== -1) || (styleId && styleId !== -1)) {
            styleSheetRuleCb({
                id,
                styleId,
                removes: [{ index }],
            });
        }
        return deleteRule.apply(this, [index]);
    };
    let replace;
    if (win.CSSStyleSheet.prototype.replace) {
        replace = win.CSSStyleSheet.prototype.replace;
        win.CSSStyleSheet.prototype.replace = function (text) {
            const { id, styleId } = getIdAndStyleId(this, mirror, stylesheetManager.styleMirror);
            if ((id && id !== -1) || (styleId && styleId !== -1)) {
                styleSheetRuleCb({
                    id,
                    styleId,
                    replace: text,
                });
            }
            return replace.apply(this, [text]);
        };
    }
    let replaceSync;
    if (win.CSSStyleSheet.prototype.replaceSync) {
        replaceSync = win.CSSStyleSheet.prototype.replaceSync;
        win.CSSStyleSheet.prototype.replaceSync = function (text) {
            const { id, styleId } = getIdAndStyleId(this, mirror, stylesheetManager.styleMirror);
            if ((id && id !== -1) || (styleId && styleId !== -1)) {
                styleSheetRuleCb({
                    id,
                    styleId,
                    replaceSync: text,
                });
            }
            return replaceSync.apply(this, [text]);
        };
    }
    const supportedNestedCSSRuleTypes = {};
    if (isCSSGroupingRuleSupported) {
        supportedNestedCSSRuleTypes.CSSGroupingRule = win.CSSGroupingRule;
    }
    else {
        if (isCSSMediaRuleSupported) {
            supportedNestedCSSRuleTypes.CSSMediaRule = win.CSSMediaRule;
        }
        if (isCSSConditionRuleSupported) {
            supportedNestedCSSRuleTypes.CSSConditionRule = win.CSSConditionRule;
        }
        if (isCSSSupportsRuleSupported) {
            supportedNestedCSSRuleTypes.CSSSupportsRule = win.CSSSupportsRule;
        }
    }
    const unmodifiedFunctions = {};
    Object.entries(supportedNestedCSSRuleTypes).forEach(([typeKey, type]) => {
        unmodifiedFunctions[typeKey] = {
            insertRule: type.prototype.insertRule,
            deleteRule: type.prototype.deleteRule,
        };
        type.prototype.insertRule = function (rule, index) {
            const { id, styleId } = getIdAndStyleId(this.parentStyleSheet, mirror, stylesheetManager.styleMirror);
            if ((id && id !== -1) || (styleId && styleId !== -1)) {
                styleSheetRuleCb({
                    id,
                    styleId,
                    adds: [
                        {
                            rule,
                            index: [
                                ...getNestedCSSRulePositions(this),
                                index || 0,
                            ],
                        },
                    ],
                });
            }
            return unmodifiedFunctions[typeKey].insertRule.apply(this, [rule, index]);
        };
        type.prototype.deleteRule = function (index) {
            const { id, styleId } = getIdAndStyleId(this.parentStyleSheet, mirror, stylesheetManager.styleMirror);
            if ((id && id !== -1) || (styleId && styleId !== -1)) {
                styleSheetRuleCb({
                    id,
                    styleId,
                    removes: [
                        { index: [...getNestedCSSRulePositions(this), index] },
                    ],
                });
            }
            return unmodifiedFunctions[typeKey].deleteRule.apply(this, [index]);
        };
    });
    return () => {
        win.CSSStyleSheet.prototype.insertRule = insertRule;
        win.CSSStyleSheet.prototype.deleteRule = deleteRule;
        replace && (win.CSSStyleSheet.prototype.replace = replace);
        replaceSync && (win.CSSStyleSheet.prototype.replaceSync = replaceSync);
        Object.entries(supportedNestedCSSRuleTypes).forEach(([typeKey, type]) => {
            type.prototype.insertRule = unmodifiedFunctions[typeKey].insertRule;
            type.prototype.deleteRule = unmodifiedFunctions[typeKey].deleteRule;
        });
    };
}
function initAdoptedStyleSheetObserver({ mirror, stylesheetManager, }, host) {
    var _a, _b, _c;
    let hostId = null;
    if (host.nodeName === '#document')
        hostId = mirror.getId(host);
    else
        hostId = mirror.getId(host.host);
    const patchTarget = host.nodeName === '#document'
        ? (_a = host.defaultView) === null || _a === void 0 ? void 0 : _a.Document
        : (_c = (_b = host.ownerDocument) === null || _b === void 0 ? void 0 : _b.defaultView) === null || _c === void 0 ? void 0 : _c.ShadowRoot;
    const originalPropertyDescriptor = Object.getOwnPropertyDescriptor(patchTarget === null || patchTarget === void 0 ? void 0 : patchTarget.prototype, 'adoptedStyleSheets');
    if (hostId === null ||
        hostId === -1 ||
        !patchTarget ||
        !originalPropertyDescriptor)
        return () => {
        };
    Object.defineProperty(host, 'adoptedStyleSheets', {
        configurable: originalPropertyDescriptor.configurable,
        enumerable: originalPropertyDescriptor.enumerable,
        get() {
            var _a;
            return (_a = originalPropertyDescriptor.get) === null || _a === void 0 ? void 0 : _a.call(this);
        },
        set(sheets) {
            var _a;
            const result = (_a = originalPropertyDescriptor.set) === null || _a === void 0 ? void 0 : _a.call(this, sheets);
            if (hostId !== null && hostId !== -1) {
                try {
                    stylesheetManager.adoptStyleSheets(sheets, hostId);
                }
                catch (e) {
                }
            }
            return result;
        },
    });
    return () => {
        Object.defineProperty(host, 'adoptedStyleSheets', {
            configurable: originalPropertyDescriptor.configurable,
            enumerable: originalPropertyDescriptor.enumerable,
            get: originalPropertyDescriptor.get,
            set: originalPropertyDescriptor.set,
        });
    };
}
function initStyleDeclarationObserver({ styleDeclarationCb, mirror, ignoreCSSAttributes, stylesheetManager, }, { win }) {
    const setProperty = win.CSSStyleDeclaration.prototype.setProperty;
    win.CSSStyleDeclaration.prototype.setProperty = function (property, value, priority) {
        var _a;
        if (ignoreCSSAttributes.has(property)) {
            return setProperty.apply(this, [property, value, priority]);
        }
        const { id, styleId } = getIdAndStyleId((_a = this.parentRule) === null || _a === void 0 ? void 0 : _a.parentStyleSheet, mirror, stylesheetManager.styleMirror);
        if ((id && id !== -1) || (styleId && styleId !== -1)) {
            styleDeclarationCb({
                id,
                styleId,
                set: {
                    property,
                    value,
                    priority,
                },
                index: getNestedCSSRulePositions(this.parentRule),
            });
        }
        return setProperty.apply(this, [property, value, priority]);
    };
    const removeProperty = win.CSSStyleDeclaration.prototype.removeProperty;
    win.CSSStyleDeclaration.prototype.removeProperty = function (property) {
        var _a;
        if (ignoreCSSAttributes.has(property)) {
            return removeProperty.apply(this, [property]);
        }
        const { id, styleId } = getIdAndStyleId((_a = this.parentRule) === null || _a === void 0 ? void 0 : _a.parentStyleSheet, mirror, stylesheetManager.styleMirror);
        if ((id && id !== -1) || (styleId && styleId !== -1)) {
            styleDeclarationCb({
                id,
                styleId,
                remove: {
                    property,
                },
                index: getNestedCSSRulePositions(this.parentRule),
            });
        }
        return removeProperty.apply(this, [property]);
    };
    return () => {
        win.CSSStyleDeclaration.prototype.setProperty = setProperty;
        win.CSSStyleDeclaration.prototype.removeProperty = removeProperty;
    };
}
function initMediaInteractionObserver({ mediaInteractionCb, blockClass, blockSelector, mirror, sampling, }) {
    const handler = (type) => throttle((event) => {
        const target = getEventTarget(event);
        if (!target ||
            isBlocked(target, blockClass, blockSelector, true)) {
            return;
        }
        const { currentTime, volume, muted, playbackRate, } = target;
        mediaInteractionCb({
            type,
            id: mirror.getId(target),
            currentTime,
            volume,
            muted,
            playbackRate,
        });
    }, sampling.media || 500);
    const handlers = [
        on('play', handler(0)),
        on('pause', handler(1)),
        on('seeked', handler(2)),
        on('volumechange', handler(3)),
        on('ratechange', handler(4)),
    ];
    return () => {
        handlers.forEach((h) => h());
    };
}
function initFontObserver({ fontCb, doc }) {
    const win = doc.defaultView;
    if (!win) {
        return () => {
        };
    }
    const handlers = [];
    const fontMap = new WeakMap();
    const originalFontFace = win.FontFace;
    win.FontFace = function FontFace(family, source, descriptors) {
        const fontFace = new originalFontFace(family, source, descriptors);
        fontMap.set(fontFace, {
            family,
            buffer: typeof source !== 'string',
            descriptors,
            fontSource: typeof source === 'string'
                ? source
                : JSON.stringify(Array.from(new Uint8Array(source))),
        });
        return fontFace;
    };
    const restoreHandler = patch(doc.fonts, 'add', function (original) {
        return function (fontFace) {
            setTimeout(() => {
                const p = fontMap.get(fontFace);
                if (p) {
                    fontCb(p);
                    fontMap.delete(fontFace);
                }
            }, 0);
            return original.apply(this, [fontFace]);
        };
    });
    handlers.push(() => {
        win.FontFace = originalFontFace;
    });
    handlers.push(restoreHandler);
    return () => {
        handlers.forEach((h) => h());
    };
}
function initSelectionObserver(param) {
    const { doc, mirror, blockClass, blockSelector, selectionCb } = param;
    let collapsed = true;
    const updateSelection = () => {
        const selection = doc.getSelection();
        if (!selection || (collapsed && (selection === null || selection === void 0 ? void 0 : selection.isCollapsed)))
            return;
        collapsed = selection.isCollapsed || false;
        const ranges = [];
        const count = selection.rangeCount || 0;
        for (let i = 0; i < count; i++) {
            const range = selection.getRangeAt(i);
            const { startContainer, startOffset, endContainer, endOffset } = range;
            const blocked = isBlocked(startContainer, blockClass, blockSelector, true) ||
                isBlocked(endContainer, blockClass, blockSelector, true);
            if (blocked)
                continue;
            ranges.push({
                start: mirror.getId(startContainer),
                startOffset,
                end: mirror.getId(endContainer),
                endOffset,
            });
        }
        selectionCb({ ranges });
    };
    updateSelection();
    return on('selectionchange', updateSelection);
}
function mergeHooks(o, hooks) {
    const { mutationCb, mousemoveCb, mouseInteractionCb, scrollCb, viewportResizeCb, inputCb, mediaInteractionCb, styleSheetRuleCb, styleDeclarationCb, canvasMutationCb, fontCb, selectionCb, } = o;
    o.mutationCb = (...p) => {
        if (hooks.mutation) {
            hooks.mutation(...p);
        }
        mutationCb(...p);
    };
    o.mousemoveCb = (...p) => {
        if (hooks.mousemove) {
            hooks.mousemove(...p);
        }
        mousemoveCb(...p);
    };
    o.mouseInteractionCb = (...p) => {
        if (hooks.mouseInteraction) {
            hooks.mouseInteraction(...p);
        }
        mouseInteractionCb(...p);
    };
    o.scrollCb = (...p) => {
        if (hooks.scroll) {
            hooks.scroll(...p);
        }
        scrollCb(...p);
    };
    o.viewportResizeCb = (...p) => {
        if (hooks.viewportResize) {
            hooks.viewportResize(...p);
        }
        viewportResizeCb(...p);
    };
    o.inputCb = (...p) => {
        if (hooks.input) {
            hooks.input(...p);
        }
        inputCb(...p);
    };
    o.mediaInteractionCb = (...p) => {
        if (hooks.mediaInteaction) {
            hooks.mediaInteaction(...p);
        }
        mediaInteractionCb(...p);
    };
    o.styleSheetRuleCb = (...p) => {
        if (hooks.styleSheetRule) {
            hooks.styleSheetRule(...p);
        }
        styleSheetRuleCb(...p);
    };
    o.styleDeclarationCb = (...p) => {
        if (hooks.styleDeclaration) {
            hooks.styleDeclaration(...p);
        }
        styleDeclarationCb(...p);
    };
    o.canvasMutationCb = (...p) => {
        if (hooks.canvasMutation) {
            hooks.canvasMutation(...p);
        }
        canvasMutationCb(...p);
    };
    o.fontCb = (...p) => {
        if (hooks.font) {
            hooks.font(...p);
        }
        fontCb(...p);
    };
    o.selectionCb = (...p) => {
        if (hooks.selection) {
            hooks.selection(...p);
        }
        selectionCb(...p);
    };
}
function initObservers(o, hooks = {}) {
    const currentWindow = o.doc.defaultView;
    if (!currentWindow) {
        return () => {
        };
    }
    mergeHooks(o, hooks);
    const mutationObserver = initMutationObserver(o, o.doc);
    const mousemoveHandler = initMoveObserver(o);
    const mouseInteractionHandler = initMouseInteractionObserver(o);
    const scrollHandler = initScrollObserver(o);
    const viewportResizeHandler = initViewportResizeObserver(o);
    const inputHandler = initInputObserver(o);
    const mediaInteractionHandler = initMediaInteractionObserver(o);
    const styleSheetObserver = initStyleSheetObserver(o, { win: currentWindow });
    const adoptedStyleSheetObserver = initAdoptedStyleSheetObserver(o, o.doc);
    const styleDeclarationObserver = initStyleDeclarationObserver(o, {
        win: currentWindow,
    });
    const fontObserver = o.collectFonts
        ? initFontObserver(o)
        : () => {
        };
    const selectionObserver = initSelectionObserver(o);
    const pluginHandlers = [];
    for (const plugin of o.plugins) {
        pluginHandlers.push(plugin.observer(plugin.callback, currentWindow, plugin.options));
    }
    return () => {
        mutationBuffers.forEach((b) => b.reset());
        mutationObserver.disconnect();
        mousemoveHandler();
        mouseInteractionHandler();
        scrollHandler();
        viewportResizeHandler();
        inputHandler();
        mediaInteractionHandler();
        styleSheetObserver();
        adoptedStyleSheetObserver();
        styleDeclarationObserver();
        fontObserver();
        selectionObserver();
        pluginHandlers.forEach((h) => h());
    };
}

class CrossOriginIframeMirror {
    constructor(generateIdFn) {
        this.generateIdFn = generateIdFn;
        this.iframeIdToRemoteIdMap = new WeakMap();
        this.iframeRemoteIdToIdMap = new WeakMap();
    }
    getId(iframe, remoteId, idToRemoteMap, remoteToIdMap) {
        const idToRemoteIdMap = idToRemoteMap || this.getIdToRemoteIdMap(iframe);
        const remoteIdToIdMap = remoteToIdMap || this.getRemoteIdToIdMap(iframe);
        let id = idToRemoteIdMap.get(remoteId);
        if (!id) {
            id = this.generateIdFn();
            idToRemoteIdMap.set(remoteId, id);
            remoteIdToIdMap.set(id, remoteId);
        }
        return id;
    }
    getIds(iframe, remoteId) {
        const idToRemoteIdMap = this.getIdToRemoteIdMap(iframe);
        const remoteIdToIdMap = this.getRemoteIdToIdMap(iframe);
        return remoteId.map((id) => this.getId(iframe, id, idToRemoteIdMap, remoteIdToIdMap));
    }
    getRemoteId(iframe, id, map) {
        const remoteIdToIdMap = map || this.getRemoteIdToIdMap(iframe);
        if (typeof id !== 'number')
            return id;
        const remoteId = remoteIdToIdMap.get(id);
        if (!remoteId)
            return -1;
        return remoteId;
    }
    getRemoteIds(iframe, ids) {
        const remoteIdToIdMap = this.getRemoteIdToIdMap(iframe);
        return ids.map((id) => this.getRemoteId(iframe, id, remoteIdToIdMap));
    }
    reset(iframe) {
        if (!iframe) {
            this.iframeIdToRemoteIdMap = new WeakMap();
            this.iframeRemoteIdToIdMap = new WeakMap();
            return;
        }
        this.iframeIdToRemoteIdMap.delete(iframe);
        this.iframeRemoteIdToIdMap.delete(iframe);
    }
    getIdToRemoteIdMap(iframe) {
        let idToRemoteIdMap = this.iframeIdToRemoteIdMap.get(iframe);
        if (!idToRemoteIdMap) {
            idToRemoteIdMap = new Map();
            this.iframeIdToRemoteIdMap.set(iframe, idToRemoteIdMap);
        }
        return idToRemoteIdMap;
    }
    getRemoteIdToIdMap(iframe) {
        let remoteIdToIdMap = this.iframeRemoteIdToIdMap.get(iframe);
        if (!remoteIdToIdMap) {
            remoteIdToIdMap = new Map();
            this.iframeRemoteIdToIdMap.set(iframe, remoteIdToIdMap);
        }
        return remoteIdToIdMap;
    }
}

class IframeManager {
    constructor(options) {
        this.iframes = new WeakMap();
        this.crossOriginIframeMap = new WeakMap();
        this.crossOriginIframeMirror = new CrossOriginIframeMirror(genId);
        this.mutationCb = options.mutationCb;
        this.wrappedEmit = options.wrappedEmit;
        this.stylesheetManager = options.stylesheetManager;
        this.recordCrossOriginIframes = options.recordCrossOriginIframes;
        this.crossOriginIframeStyleMirror = new CrossOriginIframeMirror(this.stylesheetManager.styleMirror.generateId.bind(this.stylesheetManager.styleMirror));
        this.mirror = options.mirror;
        if (this.recordCrossOriginIframes) {
            window.addEventListener('message', this.handleMessage.bind(this));
        }
    }
    addIframe(iframeEl) {
        this.iframes.set(iframeEl, true);
        if (iframeEl.contentWindow)
            this.crossOriginIframeMap.set(iframeEl.contentWindow, iframeEl);
    }
    addLoadListener(cb) {
        this.loadListener = cb;
    }
    attachIframe(iframeEl, childSn) {
        var _a;
        this.mutationCb({
            adds: [
                {
                    parentId: this.mirror.getId(iframeEl),
                    nextId: null,
                    node: childSn,
                },
            ],
            removes: [],
            texts: [],
            attributes: [],
            isAttachIframe: true,
        });
        (_a = this.loadListener) === null || _a === void 0 ? void 0 : _a.call(this, iframeEl);
        if (iframeEl.contentDocument &&
            iframeEl.contentDocument.adoptedStyleSheets &&
            iframeEl.contentDocument.adoptedStyleSheets.length > 0)
            this.stylesheetManager.adoptStyleSheets(iframeEl.contentDocument.adoptedStyleSheets, this.mirror.getId(iframeEl.contentDocument));
    }
    handleMessage(message) {
        if (message.data.type === 'rrweb') {
            const iframeSourceWindow = message.source;
            if (!iframeSourceWindow)
                return;
            const iframeEl = this.crossOriginIframeMap.get(message.source);
            if (!iframeEl)
                return;
            const transformedEvent = this.transformCrossOriginEvent(iframeEl, message.data.event);
            if (transformedEvent)
                this.wrappedEmit(transformedEvent, message.data.isCheckout);
        }
    }
    transformCrossOriginEvent(iframeEl, e) {
        var _a;
        switch (e.type) {
            case EventType.FullSnapshot: {
                this.crossOriginIframeMirror.reset(iframeEl);
                this.crossOriginIframeStyleMirror.reset(iframeEl);
                this.replaceIdOnNode(e.data.node, iframeEl);
                return {
                    timestamp: e.timestamp,
                    type: EventType.IncrementalSnapshot,
                    data: {
                        source: IncrementalSource.Mutation,
                        adds: [
                            {
                                parentId: this.mirror.getId(iframeEl),
                                nextId: null,
                                node: e.data.node,
                            },
                        ],
                        removes: [],
                        texts: [],
                        attributes: [],
                        isAttachIframe: true,
                    },
                };
            }
            case EventType.Meta:
            case EventType.Load:
            case EventType.DomContentLoaded: {
                return false;
            }
            case EventType.Plugin: {
                return e;
            }
            case EventType.Custom: {
                this.replaceIds(e.data.payload, iframeEl, ['id', 'parentId', 'previousId', 'nextId']);
                return e;
            }
            case EventType.IncrementalSnapshot: {
                switch (e.data.source) {
                    case IncrementalSource.Mutation: {
                        e.data.adds.forEach((n) => {
                            this.replaceIds(n, iframeEl, [
                                'parentId',
                                'nextId',
                                'previousId',
                            ]);
                            this.replaceIdOnNode(n.node, iframeEl);
                        });
                        e.data.removes.forEach((n) => {
                            this.replaceIds(n, iframeEl, ['parentId', 'id']);
                        });
                        e.data.attributes.forEach((n) => {
                            this.replaceIds(n, iframeEl, ['id']);
                        });
                        e.data.texts.forEach((n) => {
                            this.replaceIds(n, iframeEl, ['id']);
                        });
                        return e;
                    }
                    case IncrementalSource.Drag:
                    case IncrementalSource.TouchMove:
                    case IncrementalSource.MouseMove: {
                        e.data.positions.forEach((p) => {
                            this.replaceIds(p, iframeEl, ['id']);
                        });
                        return e;
                    }
                    case IncrementalSource.ViewportResize: {
                        return false;
                    }
                    case IncrementalSource.MediaInteraction:
                    case IncrementalSource.MouseInteraction:
                    case IncrementalSource.Scroll:
                    case IncrementalSource.CanvasMutation:
                    case IncrementalSource.Input: {
                        this.replaceIds(e.data, iframeEl, ['id']);
                        return e;
                    }
                    case IncrementalSource.StyleSheetRule:
                    case IncrementalSource.StyleDeclaration: {
                        this.replaceIds(e.data, iframeEl, ['id']);
                        this.replaceStyleIds(e.data, iframeEl, ['styleId']);
                        return e;
                    }
                    case IncrementalSource.Font: {
                        return e;
                    }
                    case IncrementalSource.Selection: {
                        e.data.ranges.forEach((range) => {
                            this.replaceIds(range, iframeEl, ['start', 'end']);
                        });
                        return e;
                    }
                    case IncrementalSource.AdoptedStyleSheet: {
                        this.replaceIds(e.data, iframeEl, ['id']);
                        this.replaceStyleIds(e.data, iframeEl, ['styleIds']);
                        (_a = e.data.styles) === null || _a === void 0 ? void 0 : _a.forEach((style) => {
                            this.replaceStyleIds(style, iframeEl, ['styleId']);
                        });
                        return e;
                    }
                }
            }
        }
    }
    replace(iframeMirror, obj, iframeEl, keys) {
        for (const key of keys) {
            if (!Array.isArray(obj[key]) && typeof obj[key] !== 'number')
                continue;
            if (Array.isArray(obj[key])) {
                obj[key] = iframeMirror.getIds(iframeEl, obj[key]);
            }
            else {
                obj[key] = iframeMirror.getId(iframeEl, obj[key]);
            }
        }
        return obj;
    }
    replaceIds(obj, iframeEl, keys) {
        return this.replace(this.crossOriginIframeMirror, obj, iframeEl, keys);
    }
    replaceStyleIds(obj, iframeEl, keys) {
        return this.replace(this.crossOriginIframeStyleMirror, obj, iframeEl, keys);
    }
    replaceIdOnNode(node, iframeEl) {
        this.replaceIds(node, iframeEl, ['id']);
        if ('childNodes' in node) {
            node.childNodes.forEach((child) => {
                this.replaceIdOnNode(child, iframeEl);
            });
        }
    }
}

class ShadowDomManager {
    constructor(options) {
        this.shadowDoms = new WeakSet();
        this.restorePatches = [];
        this.mutationCb = options.mutationCb;
        this.scrollCb = options.scrollCb;
        this.bypassOptions = options.bypassOptions;
        this.mirror = options.mirror;
        const manager = this;
        this.restorePatches.push(patch(Element.prototype, 'attachShadow', function (original) {
            return function (option) {
                const shadowRoot = original.call(this, option);
                if (this.shadowRoot)
                    manager.addShadowRoot(this.shadowRoot, this.ownerDocument);
                return shadowRoot;
            };
        }));
    }
    addShadowRoot(shadowRoot, doc) {
        if (!isNativeShadowDom(shadowRoot))
            return;
        if (this.shadowDoms.has(shadowRoot))
            return;
        this.shadowDoms.add(shadowRoot);
        initMutationObserver(Object.assign(Object.assign({}, this.bypassOptions), { doc, mutationCb: this.mutationCb, mirror: this.mirror, shadowDomManager: this }), shadowRoot);
        initScrollObserver(Object.assign(Object.assign({}, this.bypassOptions), { scrollCb: this.scrollCb, doc: shadowRoot, mirror: this.mirror }));
        setTimeout(() => {
            if (shadowRoot.adoptedStyleSheets &&
                shadowRoot.adoptedStyleSheets.length > 0)
                this.bypassOptions.stylesheetManager.adoptStyleSheets(shadowRoot.adoptedStyleSheets, this.mirror.getId(shadowRoot.host));
            initAdoptedStyleSheetObserver({
                mirror: this.mirror,
                stylesheetManager: this.bypassOptions.stylesheetManager,
            }, shadowRoot);
        }, 0);
    }
    observeAttachShadow(iframeElement) {
        if (iframeElement.contentWindow) {
            const manager = this;
            this.restorePatches.push(patch(iframeElement.contentWindow.HTMLElement.prototype, 'attachShadow', function (original) {
                return function (option) {
                    const shadowRoot = original.call(this, option);
                    if (this.shadowRoot)
                        manager.addShadowRoot(this.shadowRoot, iframeElement.contentDocument);
                    return shadowRoot;
                };
            }));
        }
    }
    reset() {
        this.restorePatches.forEach((restorePatch) => restorePatch());
        this.shadowDoms = new WeakSet();
    }
}

/*! *****************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */

function __rest(s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
}

function __awaiter(thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, [])).next());
    });
}

/*
 * base64-arraybuffer 1.0.1 <https://github.com/niklasvh/base64-arraybuffer>
 * Copyright (c) 2021 Niklas von Hertzen <https://hertzen.com>
 * Released under MIT License
 */
var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
// Use a lookup table to find the index.
var lookup = typeof Uint8Array === 'undefined' ? [] : new Uint8Array(256);
for (var i = 0; i < chars.length; i++) {
    lookup[chars.charCodeAt(i)] = i;
}
var encode = function (arraybuffer) {
    var bytes = new Uint8Array(arraybuffer), i, len = bytes.length, base64 = '';
    for (i = 0; i < len; i += 3) {
        base64 += chars[bytes[i] >> 2];
        base64 += chars[((bytes[i] & 3) << 4) | (bytes[i + 1] >> 4)];
        base64 += chars[((bytes[i + 1] & 15) << 2) | (bytes[i + 2] >> 6)];
        base64 += chars[bytes[i + 2] & 63];
    }
    if (len % 3 === 2) {
        base64 = base64.substring(0, base64.length - 1) + '=';
    }
    else if (len % 3 === 1) {
        base64 = base64.substring(0, base64.length - 2) + '==';
    }
    return base64;
};

const canvasVarMap = new Map();
function variableListFor(ctx, ctor) {
    let contextMap = canvasVarMap.get(ctx);
    if (!contextMap) {
        contextMap = new Map();
        canvasVarMap.set(ctx, contextMap);
    }
    if (!contextMap.has(ctor)) {
        contextMap.set(ctor, []);
    }
    return contextMap.get(ctor);
}
const saveWebGLVar = (value, win, ctx) => {
    if (!value ||
        !(isInstanceOfWebGLObject(value, win) || typeof value === 'object'))
        return;
    const name = value.constructor.name;
    const list = variableListFor(ctx, name);
    let index = list.indexOf(value);
    if (index === -1) {
        index = list.length;
        list.push(value);
    }
    return index;
};
function serializeArg(value, win, ctx) {
    if (value instanceof Array) {
        return value.map((arg) => serializeArg(arg, win, ctx));
    }
    else if (value === null) {
        return value;
    }
    else if (value instanceof Float32Array ||
        value instanceof Float64Array ||
        value instanceof Int32Array ||
        value instanceof Uint32Array ||
        value instanceof Uint8Array ||
        value instanceof Uint16Array ||
        value instanceof Int16Array ||
        value instanceof Int8Array ||
        value instanceof Uint8ClampedArray) {
        const name = value.constructor.name;
        return {
            rr_type: name,
            args: [Object.values(value)],
        };
    }
    else if (value instanceof ArrayBuffer) {
        const name = value.constructor.name;
        const base64 = encode(value);
        return {
            rr_type: name,
            base64,
        };
    }
    else if (value instanceof DataView) {
        const name = value.constructor.name;
        return {
            rr_type: name,
            args: [
                serializeArg(value.buffer, win, ctx),
                value.byteOffset,
                value.byteLength,
            ],
        };
    }
    else if (value instanceof HTMLImageElement) {
        const name = value.constructor.name;
        const { src } = value;
        return {
            rr_type: name,
            src,
        };
    }
    else if (value instanceof HTMLCanvasElement) {
        const name = 'HTMLImageElement';
        const src = value.toDataURL();
        return {
            rr_type: name,
            src,
        };
    }
    else if (value instanceof ImageData) {
        const name = value.constructor.name;
        return {
            rr_type: name,
            args: [serializeArg(value.data, win, ctx), value.width, value.height],
        };
    }
    else if (isInstanceOfWebGLObject(value, win) || typeof value === 'object') {
        const name = value.constructor.name;
        const index = saveWebGLVar(value, win, ctx);
        return {
            rr_type: name,
            index: index,
        };
    }
    return value;
}
const serializeArgs = (args, win, ctx) => {
    return [...args].map((arg) => serializeArg(arg, win, ctx));
};
const isInstanceOfWebGLObject = (value, win) => {
    const webGLConstructorNames = [
        'WebGLActiveInfo',
        'WebGLBuffer',
        'WebGLFramebuffer',
        'WebGLProgram',
        'WebGLRenderbuffer',
        'WebGLShader',
        'WebGLShaderPrecisionFormat',
        'WebGLTexture',
        'WebGLUniformLocation',
        'WebGLVertexArrayObject',
        'WebGLVertexArrayObjectOES',
    ];
    const supportedWebGLConstructorNames = webGLConstructorNames.filter((name) => typeof win[name] === 'function');
    return Boolean(supportedWebGLConstructorNames.find((name) => value instanceof win[name]));
};

function initCanvas2DMutationObserver(cb, win, blockClass, blockSelector) {
    const handlers = [];
    const props2D = Object.getOwnPropertyNames(win.CanvasRenderingContext2D.prototype);
    for (const prop of props2D) {
        try {
            if (typeof win.CanvasRenderingContext2D.prototype[prop] !== 'function') {
                continue;
            }
            const restoreHandler = patch(win.CanvasRenderingContext2D.prototype, prop, function (original) {
                return function (...args) {
                    if (!isBlocked(this.canvas, blockClass, blockSelector, true)) {
                        setTimeout(() => {
                            const recordArgs = serializeArgs([...args], win, this);
                            cb(this.canvas, {
                                type: CanvasContext['2D'],
                                property: prop,
                                args: recordArgs,
                            });
                        }, 0);
                    }
                    return original.apply(this, args);
                };
            });
            handlers.push(restoreHandler);
        }
        catch (_a) {
            const hookHandler = hookSetter(win.CanvasRenderingContext2D.prototype, prop, {
                set(v) {
                    cb(this.canvas, {
                        type: CanvasContext['2D'],
                        property: prop,
                        args: [v],
                        setter: true,
                    });
                },
            });
            handlers.push(hookHandler);
        }
    }
    return () => {
        handlers.forEach((h) => h());
    };
}

function initCanvasContextObserver(win, blockClass, blockSelector) {
    const handlers = [];
    try {
        const restoreHandler = patch(win.HTMLCanvasElement.prototype, 'getContext', function (original) {
            return function (contextType, ...args) {
                if (!isBlocked(this, blockClass, blockSelector, true)) {
                    if (!('__context' in this))
                        this.__context = contextType;
                }
                return original.apply(this, [contextType, ...args]);
            };
        });
        handlers.push(restoreHandler);
    }
    catch (_a) {
        console.error('failed to patch HTMLCanvasElement.prototype.getContext');
    }
    return () => {
        handlers.forEach((h) => h());
    };
}

function patchGLPrototype(prototype, type, cb, blockClass, blockSelector, mirror, win) {
    const handlers = [];
    const props = Object.getOwnPropertyNames(prototype);
    for (const prop of props) {
        if ([
            'isContextLost',
            'canvas',
            'drawingBufferWidth',
            'drawingBufferHeight',
        ].includes(prop)) {
            continue;
        }
        try {
            if (typeof prototype[prop] !== 'function') {
                continue;
            }
            const restoreHandler = patch(prototype, prop, function (original) {
                return function (...args) {
                    const result = original.apply(this, args);
                    saveWebGLVar(result, win, this);
                    if (!isBlocked(this.canvas, blockClass, blockSelector, true)) {
                        const recordArgs = serializeArgs([...args], win, this);
                        const mutation = {
                            type,
                            property: prop,
                            args: recordArgs,
                        };
                        cb(this.canvas, mutation);
                    }
                    return result;
                };
            });
            handlers.push(restoreHandler);
        }
        catch (_a) {
            const hookHandler = hookSetter(prototype, prop, {
                set(v) {
                    cb(this.canvas, {
                        type,
                        property: prop,
                        args: [v],
                        setter: true,
                    });
                },
            });
            handlers.push(hookHandler);
        }
    }
    return handlers;
}
function initCanvasWebGLMutationObserver(cb, win, blockClass, blockSelector, mirror) {
    const handlers = [];
    handlers.push(...patchGLPrototype(win.WebGLRenderingContext.prototype, CanvasContext.WebGL, cb, blockClass, blockSelector, mirror, win));
    if (typeof win.WebGL2RenderingContext !== 'undefined') {
        handlers.push(...patchGLPrototype(win.WebGL2RenderingContext.prototype, CanvasContext.WebGL2, cb, blockClass, blockSelector, mirror, win));
    }
    return () => {
        handlers.forEach((h) => h());
    };
}

var WorkerClass = null;

try {
    var WorkerThreads =
        typeof module !== 'undefined' && typeof module.require === 'function' && module.require('worker_threads') ||
        typeof __non_webpack_require__ === 'function' && __non_webpack_require__('worker_threads') ||
        typeof require === 'function' && require('worker_threads');
    WorkerClass = WorkerThreads.Worker;
} catch(e) {} // eslint-disable-line

function decodeBase64$1(base64, enableUnicode) {
    return Buffer.from(base64, 'base64').toString('utf8');
}

function createBase64WorkerFactory$2(base64, sourcemapArg, enableUnicodeArg) {
    var source = decodeBase64$1(base64);
    var start = source.indexOf('\n', 10) + 1;
    var body = source.substring(start) + ('');
    return function WorkerFactory(options) {
        return new WorkerClass(body, Object.assign({}, options, { eval: true }));
    };
}

function decodeBase64(base64, enableUnicode) {
    var binaryString = atob(base64);
    return binaryString;
}

function createURL(base64, sourcemapArg, enableUnicodeArg) {
    var source = decodeBase64(base64);
    var start = source.indexOf('\n', 10) + 1;
    var body = source.substring(start) + ('');
    var blob = new Blob([body], { type: 'application/javascript' });
    return URL.createObjectURL(blob);
}

function createBase64WorkerFactory$1(base64, sourcemapArg, enableUnicodeArg) {
    var url;
    return function WorkerFactory(options) {
        url = url || createURL(base64);
        return new Worker(url, options);
    };
}

var kIsNodeJS = Object.prototype.toString.call(typeof process !== 'undefined' ? process : 0) === '[object process]';

function isNodeJS() {
    return kIsNodeJS;
}

function createBase64WorkerFactory(base64, sourcemapArg, enableUnicodeArg) {
    if (isNodeJS()) {
        return createBase64WorkerFactory$2(base64);
    }
    return createBase64WorkerFactory$1(base64);
}

var WorkerFactory = createBase64WorkerFactory('Lyogcm9sbHVwLXBsdWdpbi13ZWItd29ya2VyLWxvYWRlciAqLwooZnVuY3Rpb24gKCkgewogICAgJ3VzZSBzdHJpY3QnOwoKICAgIC8qISAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKg0KICAgIENvcHlyaWdodCAoYykgTWljcm9zb2Z0IENvcnBvcmF0aW9uLg0KDQogICAgUGVybWlzc2lvbiB0byB1c2UsIGNvcHksIG1vZGlmeSwgYW5kL29yIGRpc3RyaWJ1dGUgdGhpcyBzb2Z0d2FyZSBmb3IgYW55DQogICAgcHVycG9zZSB3aXRoIG9yIHdpdGhvdXQgZmVlIGlzIGhlcmVieSBncmFudGVkLg0KDQogICAgVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEICJBUyBJUyIgQU5EIFRIRSBBVVRIT1IgRElTQ0xBSU1TIEFMTCBXQVJSQU5USUVTIFdJVEgNCiAgICBSRUdBUkQgVE8gVEhJUyBTT0ZUV0FSRSBJTkNMVURJTkcgQUxMIElNUExJRUQgV0FSUkFOVElFUyBPRiBNRVJDSEFOVEFCSUxJVFkNCiAgICBBTkQgRklUTkVTUy4gSU4gTk8gRVZFTlQgU0hBTEwgVEhFIEFVVEhPUiBCRSBMSUFCTEUgRk9SIEFOWSBTUEVDSUFMLCBESVJFQ1QsDQogICAgSU5ESVJFQ1QsIE9SIENPTlNFUVVFTlRJQUwgREFNQUdFUyBPUiBBTlkgREFNQUdFUyBXSEFUU09FVkVSIFJFU1VMVElORyBGUk9NDQogICAgTE9TUyBPRiBVU0UsIERBVEEgT1IgUFJPRklUUywgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIE5FR0xJR0VOQ0UgT1INCiAgICBPVEhFUiBUT1JUSU9VUyBBQ1RJT04sIEFSSVNJTkcgT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgVVNFIE9SDQogICAgUEVSRk9STUFOQ0UgT0YgVEhJUyBTT0ZUV0FSRS4NCiAgICAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiAqLw0KDQogICAgZnVuY3Rpb24gX19hd2FpdGVyKHRoaXNBcmcsIF9hcmd1bWVudHMsIFAsIGdlbmVyYXRvcikgew0KICAgICAgICBmdW5jdGlvbiBhZG9wdCh2YWx1ZSkgeyByZXR1cm4gdmFsdWUgaW5zdGFuY2VvZiBQID8gdmFsdWUgOiBuZXcgUChmdW5jdGlvbiAocmVzb2x2ZSkgeyByZXNvbHZlKHZhbHVlKTsgfSk7IH0NCiAgICAgICAgcmV0dXJuIG5ldyAoUCB8fCAoUCA9IFByb21pc2UpKShmdW5jdGlvbiAocmVzb2x2ZSwgcmVqZWN0KSB7DQogICAgICAgICAgICBmdW5jdGlvbiBmdWxmaWxsZWQodmFsdWUpIHsgdHJ5IHsgc3RlcChnZW5lcmF0b3IubmV4dCh2YWx1ZSkpOyB9IGNhdGNoIChlKSB7IHJlamVjdChlKTsgfSB9DQogICAgICAgICAgICBmdW5jdGlvbiByZWplY3RlZCh2YWx1ZSkgeyB0cnkgeyBzdGVwKGdlbmVyYXRvclsidGhyb3ciXSh2YWx1ZSkpOyB9IGNhdGNoIChlKSB7IHJlamVjdChlKTsgfSB9DQogICAgICAgICAgICBmdW5jdGlvbiBzdGVwKHJlc3VsdCkgeyByZXN1bHQuZG9uZSA/IHJlc29sdmUocmVzdWx0LnZhbHVlKSA6IGFkb3B0KHJlc3VsdC52YWx1ZSkudGhlbihmdWxmaWxsZWQsIHJlamVjdGVkKTsgfQ0KICAgICAgICAgICAgc3RlcCgoZ2VuZXJhdG9yID0gZ2VuZXJhdG9yLmFwcGx5KHRoaXNBcmcsIF9hcmd1bWVudHMgfHwgW10pKS5uZXh0KCkpOw0KICAgICAgICB9KTsNCiAgICB9CgogICAgLyoKICAgICAqIGJhc2U2NC1hcnJheWJ1ZmZlciAxLjAuMSA8aHR0cHM6Ly9naXRodWIuY29tL25pa2xhc3ZoL2Jhc2U2NC1hcnJheWJ1ZmZlcj4KICAgICAqIENvcHlyaWdodCAoYykgMjAyMSBOaWtsYXMgdm9uIEhlcnR6ZW4gPGh0dHBzOi8vaGVydHplbi5jb20+CiAgICAgKiBSZWxlYXNlZCB1bmRlciBNSVQgTGljZW5zZQogICAgICovCiAgICB2YXIgY2hhcnMgPSAnQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODkrLyc7CiAgICAvLyBVc2UgYSBsb29rdXAgdGFibGUgdG8gZmluZCB0aGUgaW5kZXguCiAgICB2YXIgbG9va3VwID0gdHlwZW9mIFVpbnQ4QXJyYXkgPT09ICd1bmRlZmluZWQnID8gW10gOiBuZXcgVWludDhBcnJheSgyNTYpOwogICAgZm9yICh2YXIgaSA9IDA7IGkgPCBjaGFycy5sZW5ndGg7IGkrKykgewogICAgICAgIGxvb2t1cFtjaGFycy5jaGFyQ29kZUF0KGkpXSA9IGk7CiAgICB9CiAgICB2YXIgZW5jb2RlID0gZnVuY3Rpb24gKGFycmF5YnVmZmVyKSB7CiAgICAgICAgdmFyIGJ5dGVzID0gbmV3IFVpbnQ4QXJyYXkoYXJyYXlidWZmZXIpLCBpLCBsZW4gPSBieXRlcy5sZW5ndGgsIGJhc2U2NCA9ICcnOwogICAgICAgIGZvciAoaSA9IDA7IGkgPCBsZW47IGkgKz0gMykgewogICAgICAgICAgICBiYXNlNjQgKz0gY2hhcnNbYnl0ZXNbaV0gPj4gMl07CiAgICAgICAgICAgIGJhc2U2NCArPSBjaGFyc1soKGJ5dGVzW2ldICYgMykgPDwgNCkgfCAoYnl0ZXNbaSArIDFdID4+IDQpXTsKICAgICAgICAgICAgYmFzZTY0ICs9IGNoYXJzWygoYnl0ZXNbaSArIDFdICYgMTUpIDw8IDIpIHwgKGJ5dGVzW2kgKyAyXSA+PiA2KV07CiAgICAgICAgICAgIGJhc2U2NCArPSBjaGFyc1tieXRlc1tpICsgMl0gJiA2M107CiAgICAgICAgfQogICAgICAgIGlmIChsZW4gJSAzID09PSAyKSB7CiAgICAgICAgICAgIGJhc2U2NCA9IGJhc2U2NC5zdWJzdHJpbmcoMCwgYmFzZTY0Lmxlbmd0aCAtIDEpICsgJz0nOwogICAgICAgIH0KICAgICAgICBlbHNlIGlmIChsZW4gJSAzID09PSAxKSB7CiAgICAgICAgICAgIGJhc2U2NCA9IGJhc2U2NC5zdWJzdHJpbmcoMCwgYmFzZTY0Lmxlbmd0aCAtIDIpICsgJz09JzsKICAgICAgICB9CiAgICAgICAgcmV0dXJuIGJhc2U2NDsKICAgIH07CgogICAgY29uc3QgbGFzdEJsb2JNYXAgPSBuZXcgTWFwKCk7DQogICAgY29uc3QgdHJhbnNwYXJlbnRCbG9iTWFwID0gbmV3IE1hcCgpOw0KICAgIGZ1bmN0aW9uIGdldFRyYW5zcGFyZW50QmxvYkZvcih3aWR0aCwgaGVpZ2h0LCBkYXRhVVJMT3B0aW9ucykgew0KICAgICAgICByZXR1cm4gX19hd2FpdGVyKHRoaXMsIHZvaWQgMCwgdm9pZCAwLCBmdW5jdGlvbiogKCkgew0KICAgICAgICAgICAgY29uc3QgaWQgPSBgJHt3aWR0aH0tJHtoZWlnaHR9YDsNCiAgICAgICAgICAgIGlmICgnT2Zmc2NyZWVuQ2FudmFzJyBpbiBnbG9iYWxUaGlzKSB7DQogICAgICAgICAgICAgICAgaWYgKHRyYW5zcGFyZW50QmxvYk1hcC5oYXMoaWQpKQ0KICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJhbnNwYXJlbnRCbG9iTWFwLmdldChpZCk7DQogICAgICAgICAgICAgICAgY29uc3Qgb2Zmc2NyZWVuID0gbmV3IE9mZnNjcmVlbkNhbnZhcyh3aWR0aCwgaGVpZ2h0KTsNCiAgICAgICAgICAgICAgICBvZmZzY3JlZW4uZ2V0Q29udGV4dCgnMmQnKTsNCiAgICAgICAgICAgICAgICBjb25zdCBibG9iID0geWllbGQgb2Zmc2NyZWVuLmNvbnZlcnRUb0Jsb2IoZGF0YVVSTE9wdGlvbnMpOw0KICAgICAgICAgICAgICAgIGNvbnN0IGFycmF5QnVmZmVyID0geWllbGQgYmxvYi5hcnJheUJ1ZmZlcigpOw0KICAgICAgICAgICAgICAgIGNvbnN0IGJhc2U2NCA9IGVuY29kZShhcnJheUJ1ZmZlcik7DQogICAgICAgICAgICAgICAgdHJhbnNwYXJlbnRCbG9iTWFwLnNldChpZCwgYmFzZTY0KTsNCiAgICAgICAgICAgICAgICByZXR1cm4gYmFzZTY0Ow0KICAgICAgICAgICAgfQ0KICAgICAgICAgICAgZWxzZSB7DQogICAgICAgICAgICAgICAgcmV0dXJuICcnOw0KICAgICAgICAgICAgfQ0KICAgICAgICB9KTsNCiAgICB9DQogICAgY29uc3Qgd29ya2VyID0gc2VsZjsNCiAgICB3b3JrZXIub25tZXNzYWdlID0gZnVuY3Rpb24gKGUpIHsNCiAgICAgICAgcmV0dXJuIF9fYXdhaXRlcih0aGlzLCB2b2lkIDAsIHZvaWQgMCwgZnVuY3Rpb24qICgpIHsNCiAgICAgICAgICAgIGlmICgnT2Zmc2NyZWVuQ2FudmFzJyBpbiBnbG9iYWxUaGlzKSB7DQogICAgICAgICAgICAgICAgY29uc3QgeyBpZCwgYml0bWFwLCB3aWR0aCwgaGVpZ2h0LCBkYXRhVVJMT3B0aW9ucyB9ID0gZS5kYXRhOw0KICAgICAgICAgICAgICAgIGNvbnN0IHRyYW5zcGFyZW50QmFzZTY0ID0gZ2V0VHJhbnNwYXJlbnRCbG9iRm9yKHdpZHRoLCBoZWlnaHQsIGRhdGFVUkxPcHRpb25zKTsNCiAgICAgICAgICAgICAgICBjb25zdCBvZmZzY3JlZW4gPSBuZXcgT2Zmc2NyZWVuQ2FudmFzKHdpZHRoLCBoZWlnaHQpOw0KICAgICAgICAgICAgICAgIGNvbnN0IGN0eCA9IG9mZnNjcmVlbi5nZXRDb250ZXh0KCcyZCcpOw0KICAgICAgICAgICAgICAgIGN0eC5kcmF3SW1hZ2UoYml0bWFwLCAwLCAwKTsNCiAgICAgICAgICAgICAgICBiaXRtYXAuY2xvc2UoKTsNCiAgICAgICAgICAgICAgICBjb25zdCBibG9iID0geWllbGQgb2Zmc2NyZWVuLmNvbnZlcnRUb0Jsb2IoZGF0YVVSTE9wdGlvbnMpOw0KICAgICAgICAgICAgICAgIGNvbnN0IHR5cGUgPSBibG9iLnR5cGU7DQogICAgICAgICAgICAgICAgY29uc3QgYXJyYXlCdWZmZXIgPSB5aWVsZCBibG9iLmFycmF5QnVmZmVyKCk7DQogICAgICAgICAgICAgICAgY29uc3QgYmFzZTY0ID0gZW5jb2RlKGFycmF5QnVmZmVyKTsNCiAgICAgICAgICAgICAgICBpZiAoIWxhc3RCbG9iTWFwLmhhcyhpZCkgJiYgKHlpZWxkIHRyYW5zcGFyZW50QmFzZTY0KSA9PT0gYmFzZTY0KSB7DQogICAgICAgICAgICAgICAgICAgIGxhc3RCbG9iTWFwLnNldChpZCwgYmFzZTY0KTsNCiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHdvcmtlci5wb3N0TWVzc2FnZSh7IGlkIH0pOw0KICAgICAgICAgICAgICAgIH0NCiAgICAgICAgICAgICAgICBpZiAobGFzdEJsb2JNYXAuZ2V0KGlkKSA9PT0gYmFzZTY0KQ0KICAgICAgICAgICAgICAgICAgICByZXR1cm4gd29ya2VyLnBvc3RNZXNzYWdlKHsgaWQgfSk7DQogICAgICAgICAgICAgICAgd29ya2VyLnBvc3RNZXNzYWdlKHsNCiAgICAgICAgICAgICAgICAgICAgaWQsDQogICAgICAgICAgICAgICAgICAgIHR5cGUsDQogICAgICAgICAgICAgICAgICAgIGJhc2U2NCwNCiAgICAgICAgICAgICAgICAgICAgd2lkdGgsDQogICAgICAgICAgICAgICAgICAgIGhlaWdodCwNCiAgICAgICAgICAgICAgICB9KTsNCiAgICAgICAgICAgICAgICBsYXN0QmxvYk1hcC5zZXQoaWQsIGJhc2U2NCk7DQogICAgICAgICAgICB9DQogICAgICAgICAgICBlbHNlIHsNCiAgICAgICAgICAgICAgICByZXR1cm4gd29ya2VyLnBvc3RNZXNzYWdlKHsgaWQ6IGUuZGF0YS5pZCB9KTsNCiAgICAgICAgICAgIH0NCiAgICAgICAgfSk7DQogICAgfTsKCn0pKCk7Cgo=');

class CanvasManager {
    constructor(options) {
        this.pendingCanvasMutations = new Map();
        this.rafStamps = { latestId: 0, invokeId: null };
        this.frozen = false;
        this.locked = false;
        this.processMutation = (target, mutation) => {
            const newFrame = this.rafStamps.invokeId &&
                this.rafStamps.latestId !== this.rafStamps.invokeId;
            if (newFrame || !this.rafStamps.invokeId)
                this.rafStamps.invokeId = this.rafStamps.latestId;
            if (!this.pendingCanvasMutations.has(target)) {
                this.pendingCanvasMutations.set(target, []);
            }
            this.pendingCanvasMutations.get(target).push(mutation);
        };
        const { sampling = 'all', win, blockClass, blockSelector, recordCanvas, dataURLOptions, } = options;
        this.mutationCb = options.mutationCb;
        this.mirror = options.mirror;
        if (recordCanvas && sampling === 'all')
            this.initCanvasMutationObserver(win, blockClass, blockSelector);
        if (recordCanvas && typeof sampling === 'number')
            this.initCanvasFPSObserver(sampling, win, blockClass, blockSelector, {
                dataURLOptions,
            });
    }
    reset() {
        this.pendingCanvasMutations.clear();
        this.resetObservers && this.resetObservers();
    }
    freeze() {
        this.frozen = true;
    }
    unfreeze() {
        this.frozen = false;
    }
    lock() {
        this.locked = true;
    }
    unlock() {
        this.locked = false;
    }
    initCanvasFPSObserver(fps, win, blockClass, blockSelector, options) {
        const canvasContextReset = initCanvasContextObserver(win, blockClass, blockSelector);
        const snapshotInProgressMap = new Map();
        const worker = new WorkerFactory();
        worker.onmessage = (e) => {
            const { id } = e.data;
            snapshotInProgressMap.set(id, false);
            if (!('base64' in e.data))
                return;
            const { base64, type, width, height } = e.data;
            this.mutationCb({
                id,
                type: CanvasContext['2D'],
                commands: [
                    {
                        property: 'clearRect',
                        args: [0, 0, width, height],
                    },
                    {
                        property: 'drawImage',
                        args: [
                            {
                                rr_type: 'ImageBitmap',
                                args: [
                                    {
                                        rr_type: 'Blob',
                                        data: [{ rr_type: 'ArrayBuffer', base64 }],
                                        type,
                                    },
                                ],
                            },
                            0,
                            0,
                        ],
                    },
                ],
            });
        };
        const timeBetweenSnapshots = 1000 / fps;
        let lastSnapshotTime = 0;
        let rafId;
        const getCanvas = () => {
            const matchedCanvas = [];
            win.document.querySelectorAll('canvas').forEach((canvas) => {
                if (!isBlocked(canvas, blockClass, blockSelector, true)) {
                    matchedCanvas.push(canvas);
                }
            });
            return matchedCanvas;
        };
        const takeCanvasSnapshots = (timestamp) => {
            if (lastSnapshotTime &&
                timestamp - lastSnapshotTime < timeBetweenSnapshots) {
                rafId = requestAnimationFrame(takeCanvasSnapshots);
                return;
            }
            lastSnapshotTime = timestamp;
            getCanvas()
                .forEach((canvas) => __awaiter(this, void 0, void 0, function* () {
                var _a;
                const id = this.mirror.getId(canvas);
                if (snapshotInProgressMap.get(id))
                    return;
                snapshotInProgressMap.set(id, true);
                if (['webgl', 'webgl2'].includes(canvas.__context)) {
                    const context = canvas.getContext(canvas.__context);
                    if (((_a = context === null || context === void 0 ? void 0 : context.getContextAttributes()) === null || _a === void 0 ? void 0 : _a.preserveDrawingBuffer) === false) {
                        context === null || context === void 0 ? void 0 : context.clear(context.COLOR_BUFFER_BIT);
                    }
                }
                const bitmap = yield createImageBitmap(canvas);
                worker.postMessage({
                    id,
                    bitmap,
                    width: canvas.width,
                    height: canvas.height,
                    dataURLOptions: options.dataURLOptions,
                }, [bitmap]);
            }));
            rafId = requestAnimationFrame(takeCanvasSnapshots);
        };
        rafId = requestAnimationFrame(takeCanvasSnapshots);
        this.resetObservers = () => {
            canvasContextReset();
            cancelAnimationFrame(rafId);
        };
    }
    initCanvasMutationObserver(win, blockClass, blockSelector) {
        this.startRAFTimestamping();
        this.startPendingCanvasMutationFlusher();
        const canvasContextReset = initCanvasContextObserver(win, blockClass, blockSelector);
        const canvas2DReset = initCanvas2DMutationObserver(this.processMutation.bind(this), win, blockClass, blockSelector);
        const canvasWebGL1and2Reset = initCanvasWebGLMutationObserver(this.processMutation.bind(this), win, blockClass, blockSelector, this.mirror);
        this.resetObservers = () => {
            canvasContextReset();
            canvas2DReset();
            canvasWebGL1and2Reset();
        };
    }
    startPendingCanvasMutationFlusher() {
        requestAnimationFrame(() => this.flushPendingCanvasMutations());
    }
    startRAFTimestamping() {
        const setLatestRAFTimestamp = (timestamp) => {
            this.rafStamps.latestId = timestamp;
            requestAnimationFrame(setLatestRAFTimestamp);
        };
        requestAnimationFrame(setLatestRAFTimestamp);
    }
    flushPendingCanvasMutations() {
        this.pendingCanvasMutations.forEach((values, canvas) => {
            const id = this.mirror.getId(canvas);
            this.flushPendingCanvasMutationFor(canvas, id);
        });
        requestAnimationFrame(() => this.flushPendingCanvasMutations());
    }
    flushPendingCanvasMutationFor(canvas, id) {
        if (this.frozen || this.locked) {
            return;
        }
        const valuesWithType = this.pendingCanvasMutations.get(canvas);
        if (!valuesWithType || id === -1)
            return;
        const values = valuesWithType.map((value) => {
            const rest = __rest(value, ["type"]);
            return rest;
        });
        const { type } = valuesWithType[0];
        this.mutationCb({ id, type, commands: values });
        this.pendingCanvasMutations.delete(canvas);
    }
}

class StylesheetManager {
    constructor(options) {
        this.trackedLinkElements = new WeakSet();
        this.styleMirror = new StyleSheetMirror();
        this.mutationCb = options.mutationCb;
        this.adoptedStyleSheetCb = options.adoptedStyleSheetCb;
    }
    attachLinkElement(linkEl, childSn) {
        if ('_cssText' in childSn.attributes)
            this.mutationCb({
                adds: [],
                removes: [],
                texts: [],
                attributes: [
                    {
                        id: childSn.id,
                        attributes: childSn
                            .attributes,
                    },
                ],
            });
        this.trackLinkElement(linkEl);
    }
    trackLinkElement(linkEl) {
        if (this.trackedLinkElements.has(linkEl))
            return;
        this.trackedLinkElements.add(linkEl);
        this.trackStylesheetInLinkElement(linkEl);
    }
    adoptStyleSheets(sheets, hostId) {
        if (sheets.length === 0)
            return;
        const adoptedStyleSheetData = {
            id: hostId,
            styleIds: [],
        };
        const styles = [];
        for (const sheet of sheets) {
            let styleId;
            if (!this.styleMirror.has(sheet)) {
                styleId = this.styleMirror.add(sheet);
                const rules = Array.from(sheet.rules || CSSRule);
                styles.push({
                    styleId,
                    rules: rules.map((r, index) => {
                        return {
                            rule: getCssRuleString(r),
                            index,
                        };
                    }),
                });
            }
            else
                styleId = this.styleMirror.getId(sheet);
            adoptedStyleSheetData.styleIds.push(styleId);
        }
        if (styles.length > 0)
            adoptedStyleSheetData.styles = styles;
        this.adoptedStyleSheetCb(adoptedStyleSheetData);
    }
    reset() {
        this.styleMirror.reset();
        this.trackedLinkElements = new WeakSet();
    }
    trackStylesheetInLinkElement(linkEl) {
    }
}

function wrapEvent(e) {
    return Object.assign(Object.assign({}, e), { timestamp: Date.now() });
}
let wrappedEmit;
let takeFullSnapshot;
let canvasManager;
let recording = false;
const mirror = createMirror();
function record(options = {}) {
    const { emit, checkoutEveryNms, checkoutEveryNth, blockClass = 'rr-block', blockSelector = null, ignoreClass = 'rr-ignore', maskTextClass = 'rr-mask', maskTextSelector = null, inlineStylesheet = true, maskAllInputs, maskInputOptions: _maskInputOptions, slimDOMOptions: _slimDOMOptions, maskInputFn, maskTextFn, hooks, packFn, sampling = {}, dataURLOptions = {}, mousemoveWait, recordCanvas = false, recordCrossOriginIframes = false, userTriggeredOnInput = false, collectFonts = false, inlineImages = false, plugins, keepIframeSrcFn = () => false, ignoreCSSAttributes = new Set([]), } = options;
    const inEmittingFrame = recordCrossOriginIframes
        ? window.parent === window
        : true;
    let passEmitsToParent = false;
    if (!inEmittingFrame) {
        try {
            window.parent.document;
            passEmitsToParent = false;
        }
        catch (e) {
            passEmitsToParent = true;
        }
    }
    if (inEmittingFrame && !emit) {
        throw new Error('emit function is required');
    }
    if (mousemoveWait !== undefined && sampling.mousemove === undefined) {
        sampling.mousemove = mousemoveWait;
    }
    mirror.reset();
    const maskInputOptions = maskAllInputs === true
        ? {
            color: true,
            date: true,
            'datetime-local': true,
            email: true,
            month: true,
            number: true,
            range: true,
            search: true,
            tel: true,
            text: true,
            time: true,
            url: true,
            week: true,
            textarea: true,
            select: true,
            password: true,
        }
        : _maskInputOptions !== undefined
            ? _maskInputOptions
            : { password: true };
    const slimDOMOptions = _slimDOMOptions === true || _slimDOMOptions === 'all'
        ? {
            script: true,
            comment: true,
            headFavicon: true,
            headWhitespace: true,
            headMetaSocial: true,
            headMetaRobots: true,
            headMetaHttpEquiv: true,
            headMetaVerification: true,
            headMetaAuthorship: _slimDOMOptions === 'all',
            headMetaDescKeywords: _slimDOMOptions === 'all',
        }
        : _slimDOMOptions
            ? _slimDOMOptions
            : {};
    polyfill();
    let lastFullSnapshotEvent;
    let incrementalSnapshotCount = 0;
    const eventProcessor = (e) => {
        for (const plugin of plugins || []) {
            if (plugin.eventProcessor) {
                e = plugin.eventProcessor(e);
            }
        }
        if (packFn) {
            e = packFn(e);
        }
        return e;
    };
    wrappedEmit = (e, isCheckout) => {
        var _a;
        if (((_a = mutationBuffers[0]) === null || _a === void 0 ? void 0 : _a.isFrozen()) &&
            e.type !== EventType.FullSnapshot &&
            !(e.type === EventType.IncrementalSnapshot &&
                e.data.source === IncrementalSource.Mutation)) {
            mutationBuffers.forEach((buf) => buf.unfreeze());
        }
        if (inEmittingFrame) {
            emit === null || emit === void 0 ? void 0 : emit(eventProcessor(e), isCheckout);
        }
        else if (passEmitsToParent) {
            const message = {
                type: 'rrweb',
                event: eventProcessor(e),
                isCheckout,
            };
            window.parent.postMessage(message, '*');
        }
        if (e.type === EventType.FullSnapshot) {
            lastFullSnapshotEvent = e;
            incrementalSnapshotCount = 0;
        }
        else if (e.type === EventType.IncrementalSnapshot) {
            if (e.data.source === IncrementalSource.Mutation &&
                e.data.isAttachIframe) {
                return;
            }
            incrementalSnapshotCount++;
            const exceedCount = checkoutEveryNth && incrementalSnapshotCount >= checkoutEveryNth;
            const exceedTime = checkoutEveryNms &&
                e.timestamp - lastFullSnapshotEvent.timestamp > checkoutEveryNms;
            if (exceedCount || exceedTime) {
                takeFullSnapshot(true);
            }
        }
    };
    const wrappedMutationEmit = (m) => {
        wrappedEmit(wrapEvent({
            type: EventType.IncrementalSnapshot,
            data: Object.assign({ source: IncrementalSource.Mutation }, m),
        }));
    };
    const wrappedScrollEmit = (p) => wrappedEmit(wrapEvent({
        type: EventType.IncrementalSnapshot,
        data: Object.assign({ source: IncrementalSource.Scroll }, p),
    }));
    const wrappedCanvasMutationEmit = (p) => wrappedEmit(wrapEvent({
        type: EventType.IncrementalSnapshot,
        data: Object.assign({ source: IncrementalSource.CanvasMutation }, p),
    }));
    const wrappedAdoptedStyleSheetEmit = (a) => wrappedEmit(wrapEvent({
        type: EventType.IncrementalSnapshot,
        data: Object.assign({ source: IncrementalSource.AdoptedStyleSheet }, a),
    }));
    const stylesheetManager = new StylesheetManager({
        mutationCb: wrappedMutationEmit,
        adoptedStyleSheetCb: wrappedAdoptedStyleSheetEmit,
    });
    const iframeManager = new IframeManager({
        mirror,
        mutationCb: wrappedMutationEmit,
        stylesheetManager: stylesheetManager,
        recordCrossOriginIframes,
        wrappedEmit,
    });
    for (const plugin of plugins || []) {
        if (plugin.getMirror)
            plugin.getMirror({
                nodeMirror: mirror,
                crossOriginIframeMirror: iframeManager.crossOriginIframeMirror,
                crossOriginIframeStyleMirror: iframeManager.crossOriginIframeStyleMirror,
            });
    }
    canvasManager = new CanvasManager({
        recordCanvas,
        mutationCb: wrappedCanvasMutationEmit,
        win: window,
        blockClass,
        blockSelector,
        mirror,
        sampling: sampling.canvas,
        dataURLOptions,
    });
    const shadowDomManager = new ShadowDomManager({
        mutationCb: wrappedMutationEmit,
        scrollCb: wrappedScrollEmit,
        bypassOptions: {
            blockClass,
            blockSelector,
            maskTextClass,
            maskTextSelector,
            inlineStylesheet,
            maskInputOptions,
            dataURLOptions,
            maskTextFn,
            maskInputFn,
            recordCanvas,
            inlineImages,
            sampling,
            slimDOMOptions,
            iframeManager,
            stylesheetManager,
            canvasManager,
            keepIframeSrcFn,
        },
        mirror,
    });
    takeFullSnapshot = (isCheckout = false) => {
        var _a, _b, _c, _d, _e, _f;
        wrappedEmit(wrapEvent({
            type: EventType.Meta,
            data: {
                href: window.location.href,
                width: getWindowWidth(),
                height: getWindowHeight(),
            },
        }), isCheckout);
        stylesheetManager.reset();
        mutationBuffers.forEach((buf) => buf.lock());
        const node = snapshot(document, {
            mirror,
            blockClass,
            blockSelector,
            maskTextClass,
            maskTextSelector,
            inlineStylesheet,
            maskAllInputs: maskInputOptions,
            maskTextFn,
            slimDOM: slimDOMOptions,
            dataURLOptions,
            recordCanvas,
            inlineImages,
            onSerialize: (n) => {
                if (isSerializedIframe(n, mirror)) {
                    iframeManager.addIframe(n);
                }
                if (isSerializedStylesheet(n, mirror)) {
                    stylesheetManager.trackLinkElement(n);
                }
                if (hasShadowRoot(n)) {
                    shadowDomManager.addShadowRoot(n.shadowRoot, document);
                }
            },
            onIframeLoad: (iframe, childSn) => {
                iframeManager.attachIframe(iframe, childSn);
                shadowDomManager.observeAttachShadow(iframe);
            },
            onStylesheetLoad: (linkEl, childSn) => {
                stylesheetManager.attachLinkElement(linkEl, childSn);
            },
            keepIframeSrcFn,
        });
        if (!node) {
            return console.warn('Failed to snapshot the document');
        }
        wrappedEmit(wrapEvent({
            type: EventType.FullSnapshot,
            data: {
                node,
                initialOffset: {
                    left: window.pageXOffset !== undefined
                        ? window.pageXOffset
                        : (document === null || document === void 0 ? void 0 : document.documentElement.scrollLeft) ||
                            ((_b = (_a = document === null || document === void 0 ? void 0 : document.body) === null || _a === void 0 ? void 0 : _a.parentElement) === null || _b === void 0 ? void 0 : _b.scrollLeft) ||
                            ((_c = document === null || document === void 0 ? void 0 : document.body) === null || _c === void 0 ? void 0 : _c.scrollLeft) ||
                            0,
                    top: window.pageYOffset !== undefined
                        ? window.pageYOffset
                        : (document === null || document === void 0 ? void 0 : document.documentElement.scrollTop) ||
                            ((_e = (_d = document === null || document === void 0 ? void 0 : document.body) === null || _d === void 0 ? void 0 : _d.parentElement) === null || _e === void 0 ? void 0 : _e.scrollTop) ||
                            ((_f = document === null || document === void 0 ? void 0 : document.body) === null || _f === void 0 ? void 0 : _f.scrollTop) ||
                            0,
                },
            },
        }));
        mutationBuffers.forEach((buf) => buf.unlock());
        if (document.adoptedStyleSheets && document.adoptedStyleSheets.length > 0)
            stylesheetManager.adoptStyleSheets(document.adoptedStyleSheets, mirror.getId(document));
    };
    try {
        const handlers = [];
        handlers.push(on('DOMContentLoaded', () => {
            wrappedEmit(wrapEvent({
                type: EventType.DomContentLoaded,
                data: {},
            }));
        }));
        const observe = (doc) => {
            var _a;
            return initObservers({
                mutationCb: wrappedMutationEmit,
                mousemoveCb: (positions, source) => wrappedEmit(wrapEvent({
                    type: EventType.IncrementalSnapshot,
                    data: {
                        source,
                        positions,
                    },
                })),
                mouseInteractionCb: (d) => wrappedEmit(wrapEvent({
                    type: EventType.IncrementalSnapshot,
                    data: Object.assign({ source: IncrementalSource.MouseInteraction }, d),
                })),
                scrollCb: wrappedScrollEmit,
                viewportResizeCb: (d) => wrappedEmit(wrapEvent({
                    type: EventType.IncrementalSnapshot,
                    data: Object.assign({ source: IncrementalSource.ViewportResize }, d),
                })),
                inputCb: (v) => wrappedEmit(wrapEvent({
                    type: EventType.IncrementalSnapshot,
                    data: Object.assign({ source: IncrementalSource.Input }, v),
                })),
                mediaInteractionCb: (p) => wrappedEmit(wrapEvent({
                    type: EventType.IncrementalSnapshot,
                    data: Object.assign({ source: IncrementalSource.MediaInteraction }, p),
                })),
                styleSheetRuleCb: (r) => wrappedEmit(wrapEvent({
                    type: EventType.IncrementalSnapshot,
                    data: Object.assign({ source: IncrementalSource.StyleSheetRule }, r),
                })),
                styleDeclarationCb: (r) => wrappedEmit(wrapEvent({
                    type: EventType.IncrementalSnapshot,
                    data: Object.assign({ source: IncrementalSource.StyleDeclaration }, r),
                })),
                canvasMutationCb: wrappedCanvasMutationEmit,
                fontCb: (p) => wrappedEmit(wrapEvent({
                    type: EventType.IncrementalSnapshot,
                    data: Object.assign({ source: IncrementalSource.Font }, p),
                })),
                selectionCb: (p) => {
                    wrappedEmit(wrapEvent({
                        type: EventType.IncrementalSnapshot,
                        data: Object.assign({ source: IncrementalSource.Selection }, p),
                    }));
                },
                blockClass,
                ignoreClass,
                maskTextClass,
                maskTextSelector,
                maskInputOptions,
                inlineStylesheet,
                sampling,
                recordCanvas,
                inlineImages,
                userTriggeredOnInput,
                collectFonts,
                doc,
                maskInputFn,
                maskTextFn,
                keepIframeSrcFn,
                blockSelector,
                slimDOMOptions,
                dataURLOptions,
                mirror,
                iframeManager,
                stylesheetManager,
                shadowDomManager,
                canvasManager,
                ignoreCSSAttributes,
                plugins: ((_a = plugins === null || plugins === void 0 ? void 0 : plugins.filter((p) => p.observer)) === null || _a === void 0 ? void 0 : _a.map((p) => ({
                    observer: p.observer,
                    options: p.options,
                    callback: (payload) => wrappedEmit(wrapEvent({
                        type: EventType.Plugin,
                        data: {
                            plugin: p.name,
                            payload,
                        },
                    })),
                }))) || [],
            }, hooks);
        };
        iframeManager.addLoadListener((iframeEl) => {
            handlers.push(observe(iframeEl.contentDocument));
        });
        const init = () => {
            takeFullSnapshot();
            handlers.push(observe(document));
            recording = true;
        };
        if (document.readyState === 'interactive' ||
            document.readyState === 'complete') {
            init();
        }
        else {
            handlers.push(on('load', () => {
                wrappedEmit(wrapEvent({
                    type: EventType.Load,
                    data: {},
                }));
                init();
            }, window));
        }
        return () => {
            handlers.forEach((h) => h());
            recording = false;
        };
    }
    catch (error) {
        console.warn(error);
    }
}
record.addCustomEvent = (tag, payload) => {
    if (!recording) {
        throw new Error('please add custom event after start recording');
    }
    wrappedEmit(wrapEvent({
        type: EventType.Custom,
        data: {
            tag,
            payload,
        },
    }));
};
record.freezePage = () => {
    mutationBuffers.forEach((buf) => buf.freeze());
};
record.takeFullSnapshot = (isCheckout) => {
    if (!recording) {
        throw new Error('please take full snapshot after start recording');
    }
    takeFullSnapshot(isCheckout);
};
record.mirror = mirror;

class RRWebTracker {
    constructor() {
        this.buffer = [];
        this.stopFn = null;
        this.recording = false;
        this.hasFullSnapshot = false;
    }
    start() {
        if (this.recording)
            return;
        const stop = record({
            emit: (event) => {
                if (event.type === 2)
                    this.hasFullSnapshot = true;
                this.buffer.push(event);
            },
            // 🧠 SNAPSHOTS
            checkoutEveryNms: 60000, // ⬅️ más largo, menos peso
            checkoutEveryNth: 0,
            sampling: {
                mousemove: false, // ⬅️ mata MBs
                mouseInteraction: true,
                scroll: 200, // 1 evento cada 200ms
                input: 'last', // solo valor final
                media: 0,
                canvas: 0,
            },
            // 🧼 PRIVACIDAD / OPTIMIZACIÓN
            maskTextClass: 'pt-sensitive',
            maskTextSelector: '[data-sensitive="true"]',
            ignoreClass: 'pt-ignore',
            blockClass: 'pt-block',
        });
        this.stopFn = stop ?? null;
        this.recording = true;
    }
    addTag(type, data = {}) {
        if (!this.recording)
            return;
        record.addCustomEvent('tag', {
            type,
            ...data,
        });
    }
    addErrorTag(error) {
        record.addCustomEvent('error', {
            message: error.message,
            stack: error.stack,
            hash: error.hash,
        });
    }
    addRageClickTag(count) {
        this.addTag('rage-click', { count });
    }
    addConversionTag(step) {
        this.addTag('conversion', { step });
    }
    canFlush() {
        return this.hasFullSnapshot;
    }
    getBufferSize() {
        return this.buffer.length;
    }
    peek() {
        return [...this.buffer];
    }
    commit() {
        this.buffer = [];
    }
    stop() {
        this.stopFn?.();
        this.stopFn = null;
        this.recording = false;
    }
    isRecording() {
        return this.recording;
    }
}

class ErrorsTracker {
    constructor(onError) {
        this.onError = onError;
        this.pageUrl = window.location.pathname;
        this.seen = new Map();
        this.handleError = (e) => {
            this.record({
                message: e.message,
                stack: e.error?.stack,
                source: e.filename,
                lineno: e.lineno,
                colno: e.colno,
            });
        };
        this.handleRejection = (e) => {
            const reason = e.reason instanceof Error
                ? e.reason
                : new Error(String(e.reason));
            this.record({
                message: reason.message,
                stack: reason.stack,
            });
        };
    }
    init() {
        window.addEventListener('error', this.handleError);
        window.addEventListener('unhandledrejection', this.handleRejection);
    }
    record(partial) {
        const error = {
            message: partial.message,
            source: partial.source,
            lineno: partial.lineno,
            colno: partial.colno,
            stack: partial.stack,
            timestamp: Date.now(),
            page: this.pageUrl,
            hash: '',
            count: 1,
            lastOccurred: Date.now(),
        };
        error.hash = this.generateErrorHash(error);
        const existing = this.seen.get(error.hash);
        if (existing) {
            existing.count++;
            existing.lastOccurred = Date.now();
            return;
        }
        this.seen.set(error.hash, error);
        this.onError(error);
    }
    generateErrorHash(err) {
        const str = `${err.message}|${err.stack ?? ''}`;
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = (hash << 5) - hash + str.charCodeAt(i);
            hash |= 0;
        }
        return hash.toString();
    }
}

class SystemTracker {
    constructor(options = {}) {
        this.options = options;
        this.isPaused = false;
        this.errors = [];
        this.handleError = (error) => {
            this.rrwebTracker.addErrorTag(error);
        };
        this.rrwebTracker = new RRWebTracker();
        this.rrwebTracker.start(); // Start the RRWeb recording
        this.rrwebOrchestrator = new RRWebOrchestrator(this.rrwebTracker, (chunk) => sendToBackend({
            ...chunk,
            token: this.options.token,
        }));
        this.errorsTracker = new ErrorsTracker((error) => {
            this.errors.push(error);
            this.addErrorTag('error', {
                message: error.message,
                stack: error.stack,
                hash: error.hash,
            });
        });
        this.init();
    }
    init() {
        this.errorsTracker.init();
    }
    start() {
        this.rrwebOrchestrator.start();
    }
    pause() {
        if (this.isPaused)
            return;
        this.isPaused = true;
        this.rrwebTracker.addTag('session_pause');
    }
    resume() {
        if (!this.isPaused)
            return;
        this.isPaused = false;
        this.rrwebTracker.addTag('session_resume');
    }
    stop() {
        this.rrwebOrchestrator.stop();
    }
    addTag(type, payload) {
        this.rrwebTracker.addTag(type, payload);
    }
    addErrorTag(type, payload) {
        this.rrwebTracker.addErrorTag({ type, ...payload });
    }
    getData() {
        return {
            errors: [...this.errors],
            rrweb: this.rrwebTracker.peek(),
        };
    }
    reset() {
        this.errors = [];
        this.rrwebTracker.commit();
    }
}

class Announcement {
    constructor(config) {
        this.isVisible = false;
        this.originalBodyPaddingTop = '';
        if (!config.tracker)
            throw new Error('Announcement requires tracker');
        this.tracker = config.tracker;
        this.config = {
            type: 'info',
            themeColor: '#3b82f6',
            autoShow: true,
            duration: 0,
            dismissible: true,
            pushBody: true,
            title: '',
            message: '',
            linkUrl: getApiUrl(''),
            linkText: 'Más información',
            ...config,
        };
        this.init();
    }
    /* ---------------- INIT ---------------- */
    async init() {
        this.addStyles();
        // 🔥 Igual que Feedback: primero intenta remoto
        this.applyRemoteConfig();
        // Si no hay mensaje, no renderiza nada
        if (!this.config.message)
            return;
        this.createAnnouncement();
        if (this.config.autoShow) {
            setTimeout(() => this.show(), 50);
        }
    }
    applyRemoteConfig() {
        this.config.message = this.config.message;
        this.config.title = this.config.title;
        this.config.linkUrl = this.config.linkUrl;
        this.config.linkText = this.config.linkText;
        this.config.type = this.config.type;
        this.config.duration =
            this.config.duration ?? 0;
        this.config.dismissible =
            this.config.dismissible ?? true;
        this.config.pushBody =
            this.config.pushBody ?? true;
    }
    /* ---------------- DOM ---------------- */
    createAnnouncement() {
        if (document.getElementById('pt-announcement-bar')) {
            this.container = document.getElementById('pt-announcement-bar');
            return;
        }
        this.container = document.createElement('div');
        this.container.id = 'pt-announcement-bar';
        this.container.className = `pt-announcement pt-${this.config.type}`;
        this.container.style.background = this.getTypeColor();
        this.container.innerHTML = `
      <div class="pt-announcement-inner">
        <div class="pt-announcement-text">
          ${this.config.title ? `<strong>${this.config.title}</strong>` : ''}
          <span>${this.config.message}</span>
          ${this.config.linkUrl
            ? `<a href="${this.config.linkUrl}" target="_blank">${this.config.linkText}</a>`
            : ''}
        </div>

        ${this.config.dismissible
            ? `<button class="pt-announcement-close">&times;</button>`
            : ''}
      </div>
    `;
        document.body.prepend(this.container);
        if (this.config.dismissible) {
            const closeBtn = this.container.querySelector('.pt-announcement-close');
            closeBtn?.addEventListener('click', () => this.hide());
        }
    }
    /* ---------------- VISIBILITY ---------------- */
    show() {
        if (!this.container || this.isVisible)
            return;
        this.isVisible = true;
        if (this.config.pushBody) {
            this.pushBodyDown();
        }
        this.container.classList.add('visible');
        if (this.config.duration && this.config.duration > 0) {
            this.closeTimeout = window.setTimeout(() => this.hide(), this.config.duration);
        }
    }
    hide() {
        if (!this.container || !this.isVisible)
            return;
        this.isVisible = false;
        this.container.classList.remove('visible');
        if (this.config.pushBody) {
            this.restoreBody();
        }
        if (this.closeTimeout) {
            clearTimeout(this.closeTimeout);
        }
    }
    /* ---------------- BODY PUSH ---------------- */
    pushBodyDown() {
        const height = this.container.offsetHeight;
        this.originalBodyPaddingTop = document.body.style.paddingTop || '';
        const currentPadding = parseInt(getComputedStyle(document.body).paddingTop || '0', 10) || 0;
        document.body.style.paddingTop = `${currentPadding + height}px`;
    }
    restoreBody() {
        document.body.style.paddingTop = this.originalBodyPaddingTop;
    }
    /* ---------------- STYLES ---------------- */
    addStyles() {
        if (document.getElementById('pt-announcement-styles'))
            return;
        const style = document.createElement('style');
        style.id = 'pt-announcement-styles';
        style.textContent = `
      .pt-announcement {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 999999;
        transform: translateY(-100%);
        transition: transform 0.3s ease;
        color: #fff;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }

      .pt-announcement.visible {
        transform: translateY(0);
      }

      .pt-announcement-inner {
        max-width: 1200px;
        margin: 0 auto;
        padding: 12px 24px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .pt-announcement-text {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        font-size: 14px;
      }

      .pt-announcement a {
        color: #fff;
        text-decoration: underline;
        font-weight: 500;
      }

      .pt-announcement-close {
        background: none;
        border: none;
        color: #fff;
        font-size: 20px;
        cursor: pointer;
        opacity: 0.7;
      }

      .pt-announcement-close:hover {
        opacity: 1;
      }

      @media (max-width: 640px) {
        .pt-announcement-inner {
          flex-direction: column;
          text-align: center;
        }
      }
    `;
        document.head.appendChild(style);
    }
    /* ---------------- HELPERS ---------------- */
    getTypeColor() {
        switch (this.config.type) {
            case 'success':
                return '#22c55e';
            case 'warning':
                return '#f59e0b';
            case 'error':
                return '#ef4444';
            default:
                return this.config.themeColor;
        }
    }
}

function getDefaultExportFromCjs (x) {
	return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, 'default') ? x['default'] : x;
}

var html2canvas$2 = {exports: {}};

/*!
 * html2canvas 1.4.1 <https://html2canvas.hertzen.com>
 * Copyright (c) 2022 Niklas von Hertzen <https://hertzen.com>
 * Released under MIT License
 */
var html2canvas$1 = html2canvas$2.exports;

var hasRequiredHtml2canvas;

function requireHtml2canvas () {
	if (hasRequiredHtml2canvas) return html2canvas$2.exports;
	hasRequiredHtml2canvas = 1;
	(function (module, exports$1) {
		(function (global, factory) {
		    module.exports = factory() ;
		}(html2canvas$1, (function () {
		    /*! *****************************************************************************
		    Copyright (c) Microsoft Corporation.

		    Permission to use, copy, modify, and/or distribute this software for any
		    purpose with or without fee is hereby granted.

		    THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
		    REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
		    AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
		    INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
		    LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
		    OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
		    PERFORMANCE OF THIS SOFTWARE.
		    ***************************************************************************** */
		    /* global Reflect, Promise */

		    var extendStatics = function(d, b) {
		        extendStatics = Object.setPrototypeOf ||
		            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
		            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
		        return extendStatics(d, b);
		    };

		    function __extends(d, b) {
		        if (typeof b !== "function" && b !== null)
		            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
		        extendStatics(d, b);
		        function __() { this.constructor = d; }
		        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
		    }

		    var __assign = function() {
		        __assign = Object.assign || function __assign(t) {
		            for (var s, i = 1, n = arguments.length; i < n; i++) {
		                s = arguments[i];
		                for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p];
		            }
		            return t;
		        };
		        return __assign.apply(this, arguments);
		    };

		    function __awaiter(thisArg, _arguments, P, generator) {
		        function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
		        return new (P || (P = Promise))(function (resolve, reject) {
		            function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
		            function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
		            function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
		            step((generator = generator.apply(thisArg, [])).next());
		        });
		    }

		    function __generator(thisArg, body) {
		        var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
		        return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
		        function verb(n) { return function (v) { return step([n, v]); }; }
		        function step(op) {
		            if (f) throw new TypeError("Generator is already executing.");
		            while (_) try {
		                if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
		                if (y = 0, t) op = [op[0] & 2, t.value];
		                switch (op[0]) {
		                    case 0: case 1: t = op; break;
		                    case 4: _.label++; return { value: op[1], done: false };
		                    case 5: _.label++; y = op[1]; op = [0]; continue;
		                    case 7: op = _.ops.pop(); _.trys.pop(); continue;
		                    default:
		                        if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
		                        if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
		                        if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
		                        if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
		                        if (t[2]) _.ops.pop();
		                        _.trys.pop(); continue;
		                }
		                op = body.call(thisArg, _);
		            } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
		            if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
		        }
		    }

		    function __spreadArray(to, from, pack) {
		        if (arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
		            if (ar || !(i in from)) {
		                if (!ar) ar = Array.prototype.slice.call(from, 0, i);
		                ar[i] = from[i];
		            }
		        }
		        return to.concat(ar || from);
		    }

		    var Bounds = /** @class */ (function () {
		        function Bounds(left, top, width, height) {
		            this.left = left;
		            this.top = top;
		            this.width = width;
		            this.height = height;
		        }
		        Bounds.prototype.add = function (x, y, w, h) {
		            return new Bounds(this.left + x, this.top + y, this.width + w, this.height + h);
		        };
		        Bounds.fromClientRect = function (context, clientRect) {
		            return new Bounds(clientRect.left + context.windowBounds.left, clientRect.top + context.windowBounds.top, clientRect.width, clientRect.height);
		        };
		        Bounds.fromDOMRectList = function (context, domRectList) {
		            var domRect = Array.from(domRectList).find(function (rect) { return rect.width !== 0; });
		            return domRect
		                ? new Bounds(domRect.left + context.windowBounds.left, domRect.top + context.windowBounds.top, domRect.width, domRect.height)
		                : Bounds.EMPTY;
		        };
		        Bounds.EMPTY = new Bounds(0, 0, 0, 0);
		        return Bounds;
		    }());
		    var parseBounds = function (context, node) {
		        return Bounds.fromClientRect(context, node.getBoundingClientRect());
		    };
		    var parseDocumentSize = function (document) {
		        var body = document.body;
		        var documentElement = document.documentElement;
		        if (!body || !documentElement) {
		            throw new Error("Unable to get document size");
		        }
		        var width = Math.max(Math.max(body.scrollWidth, documentElement.scrollWidth), Math.max(body.offsetWidth, documentElement.offsetWidth), Math.max(body.clientWidth, documentElement.clientWidth));
		        var height = Math.max(Math.max(body.scrollHeight, documentElement.scrollHeight), Math.max(body.offsetHeight, documentElement.offsetHeight), Math.max(body.clientHeight, documentElement.clientHeight));
		        return new Bounds(0, 0, width, height);
		    };

		    /*
		     * css-line-break 2.1.0 <https://github.com/niklasvh/css-line-break#readme>
		     * Copyright (c) 2022 Niklas von Hertzen <https://hertzen.com>
		     * Released under MIT License
		     */
		    var toCodePoints$1 = function (str) {
		        var codePoints = [];
		        var i = 0;
		        var length = str.length;
		        while (i < length) {
		            var value = str.charCodeAt(i++);
		            if (value >= 0xd800 && value <= 0xdbff && i < length) {
		                var extra = str.charCodeAt(i++);
		                if ((extra & 0xfc00) === 0xdc00) {
		                    codePoints.push(((value & 0x3ff) << 10) + (extra & 0x3ff) + 0x10000);
		                }
		                else {
		                    codePoints.push(value);
		                    i--;
		                }
		            }
		            else {
		                codePoints.push(value);
		            }
		        }
		        return codePoints;
		    };
		    var fromCodePoint$1 = function () {
		        var codePoints = [];
		        for (var _i = 0; _i < arguments.length; _i++) {
		            codePoints[_i] = arguments[_i];
		        }
		        if (String.fromCodePoint) {
		            return String.fromCodePoint.apply(String, codePoints);
		        }
		        var length = codePoints.length;
		        if (!length) {
		            return '';
		        }
		        var codeUnits = [];
		        var index = -1;
		        var result = '';
		        while (++index < length) {
		            var codePoint = codePoints[index];
		            if (codePoint <= 0xffff) {
		                codeUnits.push(codePoint);
		            }
		            else {
		                codePoint -= 0x10000;
		                codeUnits.push((codePoint >> 10) + 0xd800, (codePoint % 0x400) + 0xdc00);
		            }
		            if (index + 1 === length || codeUnits.length > 0x4000) {
		                result += String.fromCharCode.apply(String, codeUnits);
		                codeUnits.length = 0;
		            }
		        }
		        return result;
		    };
		    var chars$2 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
		    // Use a lookup table to find the index.
		    var lookup$2 = typeof Uint8Array === 'undefined' ? [] : new Uint8Array(256);
		    for (var i$2 = 0; i$2 < chars$2.length; i$2++) {
		        lookup$2[chars$2.charCodeAt(i$2)] = i$2;
		    }

		    /*
		     * utrie 1.0.2 <https://github.com/niklasvh/utrie>
		     * Copyright (c) 2022 Niklas von Hertzen <https://hertzen.com>
		     * Released under MIT License
		     */
		    var chars$1$1 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
		    // Use a lookup table to find the index.
		    var lookup$1$1 = typeof Uint8Array === 'undefined' ? [] : new Uint8Array(256);
		    for (var i$1$1 = 0; i$1$1 < chars$1$1.length; i$1$1++) {
		        lookup$1$1[chars$1$1.charCodeAt(i$1$1)] = i$1$1;
		    }
		    var decode$1 = function (base64) {
		        var bufferLength = base64.length * 0.75, len = base64.length, i, p = 0, encoded1, encoded2, encoded3, encoded4;
		        if (base64[base64.length - 1] === '=') {
		            bufferLength--;
		            if (base64[base64.length - 2] === '=') {
		                bufferLength--;
		            }
		        }
		        var buffer = typeof ArrayBuffer !== 'undefined' &&
		            typeof Uint8Array !== 'undefined' &&
		            typeof Uint8Array.prototype.slice !== 'undefined'
		            ? new ArrayBuffer(bufferLength)
		            : new Array(bufferLength);
		        var bytes = Array.isArray(buffer) ? buffer : new Uint8Array(buffer);
		        for (i = 0; i < len; i += 4) {
		            encoded1 = lookup$1$1[base64.charCodeAt(i)];
		            encoded2 = lookup$1$1[base64.charCodeAt(i + 1)];
		            encoded3 = lookup$1$1[base64.charCodeAt(i + 2)];
		            encoded4 = lookup$1$1[base64.charCodeAt(i + 3)];
		            bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
		            bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
		            bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
		        }
		        return buffer;
		    };
		    var polyUint16Array$1 = function (buffer) {
		        var length = buffer.length;
		        var bytes = [];
		        for (var i = 0; i < length; i += 2) {
		            bytes.push((buffer[i + 1] << 8) | buffer[i]);
		        }
		        return bytes;
		    };
		    var polyUint32Array$1 = function (buffer) {
		        var length = buffer.length;
		        var bytes = [];
		        for (var i = 0; i < length; i += 4) {
		            bytes.push((buffer[i + 3] << 24) | (buffer[i + 2] << 16) | (buffer[i + 1] << 8) | buffer[i]);
		        }
		        return bytes;
		    };

		    /** Shift size for getting the index-2 table offset. */
		    var UTRIE2_SHIFT_2$1 = 5;
		    /** Shift size for getting the index-1 table offset. */
		    var UTRIE2_SHIFT_1$1 = 6 + 5;
		    /**
		     * Shift size for shifting left the index array values.
		     * Increases possible data size with 16-bit index values at the cost
		     * of compactability.
		     * This requires data blocks to be aligned by UTRIE2_DATA_GRANULARITY.
		     */
		    var UTRIE2_INDEX_SHIFT$1 = 2;
		    /**
		     * Difference between the two shift sizes,
		     * for getting an index-1 offset from an index-2 offset. 6=11-5
		     */
		    var UTRIE2_SHIFT_1_2$1 = UTRIE2_SHIFT_1$1 - UTRIE2_SHIFT_2$1;
		    /**
		     * The part of the index-2 table for U+D800..U+DBFF stores values for
		     * lead surrogate code _units_ not code _points_.
		     * Values for lead surrogate code _points_ are indexed with this portion of the table.
		     * Length=32=0x20=0x400>>UTRIE2_SHIFT_2. (There are 1024=0x400 lead surrogates.)
		     */
		    var UTRIE2_LSCP_INDEX_2_OFFSET$1 = 0x10000 >> UTRIE2_SHIFT_2$1;
		    /** Number of entries in a data block. 32=0x20 */
		    var UTRIE2_DATA_BLOCK_LENGTH$1 = 1 << UTRIE2_SHIFT_2$1;
		    /** Mask for getting the lower bits for the in-data-block offset. */
		    var UTRIE2_DATA_MASK$1 = UTRIE2_DATA_BLOCK_LENGTH$1 - 1;
		    var UTRIE2_LSCP_INDEX_2_LENGTH$1 = 0x400 >> UTRIE2_SHIFT_2$1;
		    /** Count the lengths of both BMP pieces. 2080=0x820 */
		    var UTRIE2_INDEX_2_BMP_LENGTH$1 = UTRIE2_LSCP_INDEX_2_OFFSET$1 + UTRIE2_LSCP_INDEX_2_LENGTH$1;
		    /**
		     * The 2-byte UTF-8 version of the index-2 table follows at offset 2080=0x820.
		     * Length 32=0x20 for lead bytes C0..DF, regardless of UTRIE2_SHIFT_2.
		     */
		    var UTRIE2_UTF8_2B_INDEX_2_OFFSET$1 = UTRIE2_INDEX_2_BMP_LENGTH$1;
		    var UTRIE2_UTF8_2B_INDEX_2_LENGTH$1 = 0x800 >> 6; /* U+0800 is the first code point after 2-byte UTF-8 */
		    /**
		     * The index-1 table, only used for supplementary code points, at offset 2112=0x840.
		     * Variable length, for code points up to highStart, where the last single-value range starts.
		     * Maximum length 512=0x200=0x100000>>UTRIE2_SHIFT_1.
		     * (For 0x100000 supplementary code points U+10000..U+10ffff.)
		     *
		     * The part of the index-2 table for supplementary code points starts
		     * after this index-1 table.
		     *
		     * Both the index-1 table and the following part of the index-2 table
		     * are omitted completely if there is only BMP data.
		     */
		    var UTRIE2_INDEX_1_OFFSET$1 = UTRIE2_UTF8_2B_INDEX_2_OFFSET$1 + UTRIE2_UTF8_2B_INDEX_2_LENGTH$1;
		    /**
		     * Number of index-1 entries for the BMP. 32=0x20
		     * This part of the index-1 table is omitted from the serialized form.
		     */
		    var UTRIE2_OMITTED_BMP_INDEX_1_LENGTH$1 = 0x10000 >> UTRIE2_SHIFT_1$1;
		    /** Number of entries in an index-2 block. 64=0x40 */
		    var UTRIE2_INDEX_2_BLOCK_LENGTH$1 = 1 << UTRIE2_SHIFT_1_2$1;
		    /** Mask for getting the lower bits for the in-index-2-block offset. */
		    var UTRIE2_INDEX_2_MASK$1 = UTRIE2_INDEX_2_BLOCK_LENGTH$1 - 1;
		    var slice16$1 = function (view, start, end) {
		        if (view.slice) {
		            return view.slice(start, end);
		        }
		        return new Uint16Array(Array.prototype.slice.call(view, start, end));
		    };
		    var slice32$1 = function (view, start, end) {
		        if (view.slice) {
		            return view.slice(start, end);
		        }
		        return new Uint32Array(Array.prototype.slice.call(view, start, end));
		    };
		    var createTrieFromBase64$1 = function (base64, _byteLength) {
		        var buffer = decode$1(base64);
		        var view32 = Array.isArray(buffer) ? polyUint32Array$1(buffer) : new Uint32Array(buffer);
		        var view16 = Array.isArray(buffer) ? polyUint16Array$1(buffer) : new Uint16Array(buffer);
		        var headerLength = 24;
		        var index = slice16$1(view16, headerLength / 2, view32[4] / 2);
		        var data = view32[5] === 2
		            ? slice16$1(view16, (headerLength + view32[4]) / 2)
		            : slice32$1(view32, Math.ceil((headerLength + view32[4]) / 4));
		        return new Trie$1(view32[0], view32[1], view32[2], view32[3], index, data);
		    };
		    var Trie$1 = /** @class */ (function () {
		        function Trie(initialValue, errorValue, highStart, highValueIndex, index, data) {
		            this.initialValue = initialValue;
		            this.errorValue = errorValue;
		            this.highStart = highStart;
		            this.highValueIndex = highValueIndex;
		            this.index = index;
		            this.data = data;
		        }
		        /**
		         * Get the value for a code point as stored in the Trie.
		         *
		         * @param codePoint the code point
		         * @return the value
		         */
		        Trie.prototype.get = function (codePoint) {
		            var ix;
		            if (codePoint >= 0) {
		                if (codePoint < 0x0d800 || (codePoint > 0x0dbff && codePoint <= 0x0ffff)) {
		                    // Ordinary BMP code point, excluding leading surrogates.
		                    // BMP uses a single level lookup.  BMP index starts at offset 0 in the Trie2 index.
		                    // 16 bit data is stored in the index array itself.
		                    ix = this.index[codePoint >> UTRIE2_SHIFT_2$1];
		                    ix = (ix << UTRIE2_INDEX_SHIFT$1) + (codePoint & UTRIE2_DATA_MASK$1);
		                    return this.data[ix];
		                }
		                if (codePoint <= 0xffff) {
		                    // Lead Surrogate Code Point.  A Separate index section is stored for
		                    // lead surrogate code units and code points.
		                    //   The main index has the code unit data.
		                    //   For this function, we need the code point data.
		                    // Note: this expression could be refactored for slightly improved efficiency, but
		                    //       surrogate code points will be so rare in practice that it's not worth it.
		                    ix = this.index[UTRIE2_LSCP_INDEX_2_OFFSET$1 + ((codePoint - 0xd800) >> UTRIE2_SHIFT_2$1)];
		                    ix = (ix << UTRIE2_INDEX_SHIFT$1) + (codePoint & UTRIE2_DATA_MASK$1);
		                    return this.data[ix];
		                }
		                if (codePoint < this.highStart) {
		                    // Supplemental code point, use two-level lookup.
		                    ix = UTRIE2_INDEX_1_OFFSET$1 - UTRIE2_OMITTED_BMP_INDEX_1_LENGTH$1 + (codePoint >> UTRIE2_SHIFT_1$1);
		                    ix = this.index[ix];
		                    ix += (codePoint >> UTRIE2_SHIFT_2$1) & UTRIE2_INDEX_2_MASK$1;
		                    ix = this.index[ix];
		                    ix = (ix << UTRIE2_INDEX_SHIFT$1) + (codePoint & UTRIE2_DATA_MASK$1);
		                    return this.data[ix];
		                }
		                if (codePoint <= 0x10ffff) {
		                    return this.data[this.highValueIndex];
		                }
		            }
		            // Fall through.  The code point is outside of the legal range of 0..0x10ffff.
		            return this.errorValue;
		        };
		        return Trie;
		    }());

		    /*
		     * base64-arraybuffer 1.0.2 <https://github.com/niklasvh/base64-arraybuffer>
		     * Copyright (c) 2022 Niklas von Hertzen <https://hertzen.com>
		     * Released under MIT License
		     */
		    var chars$3 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
		    // Use a lookup table to find the index.
		    var lookup$3 = typeof Uint8Array === 'undefined' ? [] : new Uint8Array(256);
		    for (var i$3 = 0; i$3 < chars$3.length; i$3++) {
		        lookup$3[chars$3.charCodeAt(i$3)] = i$3;
		    }

		    var base64$1 = 'KwAAAAAAAAAACA4AUD0AADAgAAACAAAAAAAIABAAGABAAEgAUABYAGAAaABgAGgAYgBqAF8AZwBgAGgAcQB5AHUAfQCFAI0AlQCdAKIAqgCyALoAYABoAGAAaABgAGgAwgDKAGAAaADGAM4A0wDbAOEA6QDxAPkAAQEJAQ8BFwF1AH0AHAEkASwBNAE6AUIBQQFJAVEBWQFhAWgBcAF4ATAAgAGGAY4BlQGXAZ8BpwGvAbUBvQHFAc0B0wHbAeMB6wHxAfkBAQIJAvEBEQIZAiECKQIxAjgCQAJGAk4CVgJeAmQCbAJ0AnwCgQKJApECmQKgAqgCsAK4ArwCxAIwAMwC0wLbAjAA4wLrAvMC+AIAAwcDDwMwABcDHQMlAy0DNQN1AD0DQQNJA0kDSQNRA1EDVwNZA1kDdQB1AGEDdQBpA20DdQN1AHsDdQCBA4kDkQN1AHUAmQOhA3UAdQB1AHUAdQB1AHUAdQB1AHUAdQB1AHUAdQB1AHUAdQB1AKYDrgN1AHUAtgO+A8YDzgPWAxcD3gPjA+sD8wN1AHUA+wMDBAkEdQANBBUEHQQlBCoEFwMyBDgEYABABBcDSARQBFgEYARoBDAAcAQzAXgEgASIBJAEdQCXBHUAnwSnBK4EtgS6BMIEyAR1AHUAdQB1AHUAdQCVANAEYABgAGAAYABgAGAAYABgANgEYADcBOQEYADsBPQE/AQEBQwFFAUcBSQFLAU0BWQEPAVEBUsFUwVbBWAAYgVgAGoFcgV6BYIFigWRBWAAmQWfBaYFYABgAGAAYABgAKoFYACxBbAFuQW6BcEFwQXHBcEFwQXPBdMF2wXjBeoF8gX6BQIGCgYSBhoGIgYqBjIGOgZgAD4GRgZMBmAAUwZaBmAAYABgAGAAYABgAGAAYABgAGAAYABgAGIGYABpBnAGYABgAGAAYABgAGAAYABgAGAAYAB4Bn8GhQZgAGAAYAB1AHcDFQSLBmAAYABgAJMGdQA9A3UAmwajBqsGqwaVALMGuwbDBjAAywbSBtIG1QbSBtIG0gbSBtIG0gbdBuMG6wbzBvsGAwcLBxMHAwcbByMHJwcsBywHMQcsB9IGOAdAB0gHTgfSBkgHVgfSBtIG0gbSBtIG0gbSBtIG0gbSBiwHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAdgAGAALAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAdbB2MHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsB2kH0gZwB64EdQB1AHUAdQB1AHUAdQB1AHUHfQdgAIUHjQd1AHUAlQedB2AAYAClB6sHYACzB7YHvgfGB3UAzgfWBzMB3gfmB1EB7gf1B/0HlQENAQUIDQh1ABUIHQglCBcDLQg1CD0IRQhNCEEDUwh1AHUAdQBbCGMIZAhlCGYIZwhoCGkIYwhkCGUIZghnCGgIaQhjCGQIZQhmCGcIaAhpCGMIZAhlCGYIZwhoCGkIYwhkCGUIZghnCGgIaQhjCGQIZQhmCGcIaAhpCGMIZAhlCGYIZwhoCGkIYwhkCGUIZghnCGgIaQhjCGQIZQhmCGcIaAhpCGMIZAhlCGYIZwhoCGkIYwhkCGUIZghnCGgIaQhjCGQIZQhmCGcIaAhpCGMIZAhlCGYIZwhoCGkIYwhkCGUIZghnCGgIaQhjCGQIZQhmCGcIaAhpCGMIZAhlCGYIZwhoCGkIYwhkCGUIZghnCGgIaQhjCGQIZQhmCGcIaAhpCGMIZAhlCGYIZwhoCGkIYwhkCGUIZghnCGgIaQhjCGQIZQhmCGcIaAhpCGMIZAhlCGYIZwhoCGkIYwhkCGUIZghnCGgIaQhjCGQIZQhmCGcIaAhpCGMIZAhlCGYIZwhoCGkIYwhkCGUIZghnCGgIaQhjCGQIZQhmCGcIaAhpCGMIZAhlCGYIZwhoCGkIYwhkCGUIZghnCGgIaQhjCGQIZQhmCGcIaAhpCGMIZAhlCGYIZwhoCGkIYwhkCGUIZghnCGgIaQhjCGQIZQhmCGcIaAhpCGMIZAhlCGYIZwhoCGkIYwhkCGUIZghnCGgIaQhjCGQIZQhmCGcIaAhpCGMIZAhlCGYIZwhoCGkIYwhkCGUIZghnCGgIaQhjCGQIZQhmCGcIaAhpCGMIZAhlCGYIZwhoCGkIYwhkCGUIZghnCGgIaQhjCGQIZQhmCGcIaAhpCGMIZAhlCGYIZwhoCGkIYwhkCGUIZghnCGgIaQhjCGQIZQhmCGcIaAhpCGMIZAhlCGYIZwhoCGkIYwhkCGUIZghnCGgIaQhjCGQIZQhmCGcIaAhpCGMIZAhlCGYIZwhoCGkIYwhkCGUIZghnCGgIcAh3CHoIMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwAIIIggiCCIIIggiCCIIIggiCCIIIggiCCIIIggiCCIIIggiCCIIIggiCCIIIggiCCIIIggiCCIIIggiCCIIIgggwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAALAcsBywHLAcsBywHLAcsBywHLAcsB4oILAcsB44I0gaWCJ4Ipgh1AHUAqgiyCHUAdQB1AHUAdQB1AHUAdQB1AHUAtwh8AXUAvwh1AMUIyQjRCNkI4AjoCHUAdQB1AO4I9gj+CAYJDgkTCS0HGwkjCYIIggiCCIIIggiCCIIIggiCCIIIggiCCIIIggiCCIIIggiCCIIIggiCCIIIggiCCIIIggiCCIIIggiCCIIIggiAAIAAAAFAAYABgAGIAXwBgAHEAdQBFAJUAogCyAKAAYABgAEIA4ABGANMA4QDxAMEBDwE1AFwBLAE6AQEBUQF4QkhCmEKoQrhCgAHIQsAB0MLAAcABwAHAAeDC6ABoAHDCwMMAAcABwAHAAdDDGMMAAcAB6MM4wwjDWMNow3jDaABoAGgAaABoAGgAaABoAGgAaABoAGgAaABoAGgAaABoAGgAaABoAEjDqABWw6bDqABpg6gAaABoAHcDvwOPA+gAaABfA/8DvwO/A78DvwO/A78DvwO/A78DvwO/A78DvwO/A78DvwO/A78DvwO/A78DvwO/A78DvwO/A78DpcPAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcAB9cPKwkyCToJMAB1AHUAdQBCCUoJTQl1AFUJXAljCWcJawkwADAAMAAwAHMJdQB2CX4JdQCECYoJjgmWCXUAngkwAGAAYABxAHUApgn3A64JtAl1ALkJdQDACTAAMAAwADAAdQB1AHUAdQB1AHUAdQB1AHUAowYNBMUIMAAwADAAMADICcsJ0wnZCRUE4QkwAOkJ8An4CTAAMAB1AAAKvwh1AAgKDwoXCh8KdQAwACcKLgp1ADYKqAmICT4KRgowADAAdQB1AE4KMAB1AFYKdQBeCnUAZQowADAAMAAwADAAMAAwADAAMAAVBHUAbQowADAAdQC5CXUKMAAwAHwBxAijBogEMgF9CoQKiASMCpQKmgqIBKIKqgquCogEDQG2Cr4KxgrLCjAAMADTCtsKCgHjCusK8Qr5CgELMAAwADAAMAB1AIsECQsRC3UANAEZCzAAMAAwADAAMAB1ACELKQswAHUANAExCzkLdQBBC0kLMABRC1kLMAAwADAAMAAwADAAdQBhCzAAMAAwAGAAYABpC3ELdwt/CzAAMACHC4sLkwubC58Lpwt1AK4Ltgt1APsDMAAwADAAMAAwADAAMAAwAL4LwwvLC9IL1wvdCzAAMADlC+kL8Qv5C/8LSQswADAAMAAwADAAMAAwADAAMAAHDDAAMAAwADAAMAAODBYMHgx1AHUAdQB1AHUAdQB1AHUAdQB1AHUAdQB1AHUAdQB1AHUAdQB1AHUAdQB1AHUAdQB1AHUAdQB1ACYMMAAwADAAdQB1AHUALgx1AHUAdQB1AHUAdQA2DDAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwAHUAdQB1AHUAdQB1AHUAdQB1AHUAdQB1AHUAdQB1AHUAdQB1AD4MdQBGDHUAdQB1AHUAdQB1AEkMdQB1AHUAdQB1AFAMMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwAHUAdQB1AHUAdQB1AHUAdQB1AHUAdQB1AHUAdQBYDHUAdQB1AF8MMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAB1AHUAdQB1AHUAdQB1AHUAdQB1AHUAdQB1AHUAdQB1AHUA+wMVBGcMMAAwAHwBbwx1AHcMfwyHDI8MMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAYABgAJcMMAAwADAAdQB1AJ8MlQClDDAAMACtDCwHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsB7UMLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHdQB1AHUAdQB1AHUAdQB1AHUAdQB1AHUAdQB1AA0EMAC9DDAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAsBywHLAcsBywHLAcsBywHLQcwAMEMyAwsBywHLAcsBywHLAcsBywHLAcsBywHzAwwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwAHUAdQB1ANQM2QzhDDAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMABgAGAAYABgAGAAYABgAOkMYADxDGAA+AwADQYNYABhCWAAYAAODTAAMAAwADAAFg1gAGAAHg37AzAAMAAwADAAYABgACYNYAAsDTQNPA1gAEMNPg1LDWAAYABgAGAAYABgAGAAYABgAGAAUg1aDYsGVglhDV0NcQBnDW0NdQ15DWAAYABgAGAAYABgAGAAYABgAGAAYABgAGAAYABgAGAAlQCBDZUAiA2PDZcNMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAnw2nDTAAMAAwADAAMAAwAHUArw23DTAAMAAwADAAMAAwADAAMAAwADAAMAB1AL8NMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAB1AHUAdQB1AHUAdQDHDTAAYABgAM8NMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAA1w11ANwNMAAwAD0B5A0wADAAMAAwADAAMADsDfQN/A0EDgwOFA4wABsOMAAwADAAMAAwADAAMAAwANIG0gbSBtIG0gbSBtIG0gYjDigOwQUuDsEFMw7SBjoO0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIGQg5KDlIOVg7SBtIGXg5lDm0OdQ7SBtIGfQ6EDooOjQ6UDtIGmg6hDtIG0gaoDqwO0ga0DrwO0gZgAGAAYADEDmAAYAAkBtIGzA5gANIOYADaDokO0gbSBt8O5w7SBu8O0gb1DvwO0gZgAGAAxA7SBtIG0gbSBtIGYABgAGAAYAAED2AAsAUMD9IG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIGFA8sBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAccD9IGLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHJA8sBywHLAcsBywHLAccDywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywPLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAc0D9IG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIGLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAccD9IG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIGFA8sBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHLAcsBywHPA/SBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gbSBtIG0gYUD0QPlQCVAJUAMAAwADAAMACVAJUAlQCVAJUAlQCVAEwPMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAA//8EAAQABAAEAAQABAAEAAQABAANAAMAAQABAAIABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQACgATABcAHgAbABoAHgAXABYAEgAeABsAGAAPABgAHABLAEsASwBLAEsASwBLAEsASwBLABgAGAAeAB4AHgATAB4AUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQABYAGwASAB4AHgAeAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAAWAA0AEQAeAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArAAQABAAEAAQABAAFAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAJABYAGgAbABsAGwAeAB0AHQAeAE8AFwAeAA0AHgAeABoAGwBPAE8ADgBQAB0AHQAdAE8ATwAXAE8ATwBPABYAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAB0AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAdAFAAUABQAFAAUABQAFAAUAAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAFAAHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAAeAB4AHgAeAFAATwBAAE8ATwBPAEAATwBQAFAATwBQAB4AHgAeAB4AHgAeAB0AHQAdAB0AHgAdAB4ADgBQAFAAUABQAFAAHgAeAB4AHgAeAB4AHgBQAB4AUAAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4ABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAJAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAkACQAJAAkACQAJAAkABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAeAB4AHgAeAFAAHgAeAB4AKwArAFAAUABQAFAAGABQACsAKwArACsAHgAeAFAAHgBQAFAAUAArAFAAKwAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AKwAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4ABAAEAAQABAAEAAQABAAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgArAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAArACsAUAAeAB4AHgAeAB4AHgBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAAYAA0AKwArAB4AHgAbACsABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQADQAEAB4ABAAEAB4ABAAEABMABAArACsAKwArACsAKwArACsAVgBWAFYAVgBWAFYAVgBWAFYAVgBWAFYAVgBWAFYAVgBWAFYAVgBWAFYAVgBWAFYAVgBWAFYAKwArACsAKwBWAFYAVgBWAB4AHgArACsAKwArACsAKwArACsAKwArACsAHgAeAB4AHgAeAB4AHgAeAB4AGgAaABoAGAAYAB4AHgAEAAQABAAEAAQABAAEAAQABAAEAAQAEwAEACsAEwATAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABABLAEsASwBLAEsASwBLAEsASwBLABoAGQAZAB4AUABQAAQAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQABMAUAAEAAQABAAEAAQABAAEAB4AHgAEAAQABAAEAAQABABQAFAABAAEAB4ABAAEAAQABABQAFAASwBLAEsASwBLAEsASwBLAEsASwBQAFAAUAAeAB4AUAAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AKwAeAFAABABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEACsAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAABAAEAAQABAAEAAQABAAEAAQABAAEAFAAKwArACsAKwArACsAKwArACsAKwArACsAKwArAEsASwBLAEsASwBLAEsASwBLAEsAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAABAAEAAQABAAEAAQABAAEAAQAUABQAB4AHgAYABMAUAArACsABAAbABsAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAAEAAQABAAEAFAABAAEAAQABAAEAFAABAAEAAQAUAAEAAQABAAEAAQAKwArAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeACsAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAAEAAQABAArACsAHgArAFAAUABQAFAAUABQAFAAUABQAFAAUAArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAArAFAAUABQAFAAUABQAFAAUABQAFAAKwArACsAKwArACsAKwArACsAKwArAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAB4ABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAAQABAAEAFAABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQAUAAEAAQABAAEAAQABAAEAFAAUABQAFAAUABQAFAAUABQAFAABAAEAA0ADQBLAEsASwBLAEsASwBLAEsASwBLAB4AUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAAEAAQABAArAFAAUABQAFAAUABQAFAAUAArACsAUABQACsAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAKwBQAFAAUABQAFAAUABQACsAUAArACsAKwBQAFAAUABQACsAKwAEAFAABAAEAAQABAAEAAQABAArACsABAAEACsAKwAEAAQABABQACsAKwArACsAKwArACsAKwAEACsAKwArACsAUABQACsAUABQAFAABAAEACsAKwBLAEsASwBLAEsASwBLAEsASwBLAFAAUAAaABoAUABQAFAAUABQAEwAHgAbAFAAHgAEACsAKwAEAAQABAArAFAAUABQAFAAUABQACsAKwArACsAUABQACsAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAKwBQAFAAUABQAFAAUABQACsAUABQACsAUABQACsAUABQACsAKwAEACsABAAEAAQABAAEACsAKwArACsABAAEACsAKwAEAAQABAArACsAKwAEACsAKwArACsAKwArACsAUABQAFAAUAArAFAAKwArACsAKwArACsAKwBLAEsASwBLAEsASwBLAEsASwBLAAQABABQAFAAUAAEAB4AKwArACsAKwArACsAKwArACsAKwAEAAQABAArAFAAUABQAFAAUABQAFAAUABQACsAUABQAFAAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAKwBQAFAAUABQAFAAUABQACsAUABQACsAUABQAFAAUABQACsAKwAEAFAABAAEAAQABAAEAAQABAAEACsABAAEAAQAKwAEAAQABAArACsAUAArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwBQAFAABAAEACsAKwBLAEsASwBLAEsASwBLAEsASwBLAB4AGwArACsAKwArACsAKwArAFAABAAEAAQABAAEAAQAKwAEAAQABAArAFAAUABQAFAAUABQAFAAUAArACsAUABQACsAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAAQABAAEAAQABAArACsABAAEACsAKwAEAAQABAArACsAKwArACsAKwArAAQABAAEACsAKwArACsAUABQACsAUABQAFAABAAEACsAKwBLAEsASwBLAEsASwBLAEsASwBLAB4AUABQAFAAUABQAFAAUAArACsAKwArACsAKwArACsAKwArAAQAUAArAFAAUABQAFAAUABQACsAKwArAFAAUABQACsAUABQAFAAUAArACsAKwBQAFAAKwBQACsAUABQACsAKwArAFAAUAArACsAKwBQAFAAUAArACsAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUAArACsAKwArAAQABAAEAAQABAArACsAKwAEAAQABAArAAQABAAEAAQAKwArAFAAKwArACsAKwArACsABAArACsAKwArACsAKwArACsAKwArAEsASwBLAEsASwBLAEsASwBLAEsAUABQAFAAHgAeAB4AHgAeAB4AGwAeACsAKwArACsAKwAEAAQABAAEAAQAUABQAFAAUABQAFAAUABQACsAUABQAFAAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAArAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAKwArACsAUAAEAAQABAAEAAQABAAEACsABAAEAAQAKwAEAAQABAAEACsAKwArACsAKwArACsABAAEACsAUABQAFAAKwArACsAKwArAFAAUAAEAAQAKwArAEsASwBLAEsASwBLAEsASwBLAEsAKwArACsAKwArACsAKwAOAFAAUABQAFAAUABQAFAAHgBQAAQABAAEAA4AUABQAFAAUABQAFAAUABQACsAUABQAFAAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAArAFAAUABQAFAAUABQAFAAUABQAFAAKwBQAFAAUABQAFAAKwArAAQAUAAEAAQABAAEAAQABAAEACsABAAEAAQAKwAEAAQABAAEACsAKwArACsAKwArACsABAAEACsAKwArACsAKwArACsAUAArAFAAUAAEAAQAKwArAEsASwBLAEsASwBLAEsASwBLAEsAKwBQAFAAKwArACsAKwArACsAKwArACsAKwArACsAKwAEAAQABAAEAFAAUABQAFAAUABQAFAAUABQACsAUABQAFAAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAABAAEAFAABAAEAAQABAAEAAQABAArAAQABAAEACsABAAEAAQABABQAB4AKwArACsAKwBQAFAAUAAEAFAAUABQAFAAUABQAFAAUABQAFAABAAEACsAKwBLAEsASwBLAEsASwBLAEsASwBLAFAAUABQAFAAUABQAFAAUABQABoAUABQAFAAUABQAFAAKwAEAAQABAArAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQACsAKwArAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAArAFAAUABQAFAAUABQAFAAUABQACsAUAArACsAUABQAFAAUABQAFAAUAArACsAKwAEACsAKwArACsABAAEAAQABAAEAAQAKwAEACsABAAEAAQABAAEAAQABAAEACsAKwArACsAKwArAEsASwBLAEsASwBLAEsASwBLAEsAKwArAAQABAAeACsAKwArACsAKwArACsAKwArACsAKwArAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXAAqAFwAXAAqACoAKgAqACoAKgAqACsAKwArACsAGwBcAFwAXABcAFwAXABcACoAKgAqACoAKgAqACoAKgAeAEsASwBLAEsASwBLAEsASwBLAEsADQANACsAKwArACsAKwBcAFwAKwBcACsAXABcAFwAXABcACsAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcACsAXAArAFwAXABcAFwAXABcAFwAXABcAFwAKgBcAFwAKgAqACoAKgAqACoAKgAqACoAXAArACsAXABcAFwAXABcACsAXAArACoAKgAqACoAKgAqACsAKwBLAEsASwBLAEsASwBLAEsASwBLACsAKwBcAFwAXABcAFAADgAOAA4ADgAeAA4ADgAJAA4ADgANAAkAEwATABMAEwATAAkAHgATAB4AHgAeAAQABAAeAB4AHgAeAB4AHgBLAEsASwBLAEsASwBLAEsASwBLAFAAUABQAFAAUABQAFAAUABQAFAADQAEAB4ABAAeAAQAFgARABYAEQAEAAQAUABQAFAAUABQAFAAUABQACsAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAKwArACsAKwAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQADQAEAAQABAAEAAQADQAEAAQAUABQAFAAUABQAAQABAAEAAQABAAEAAQABAAEAAQABAArAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAArAA0ADQAeAB4AHgAeAB4AHgAEAB4AHgAeAB4AHgAeACsAHgAeAA4ADgANAA4AHgAeAB4AHgAeAAkACQArACsAKwArACsAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcACoAKgAqACoAKgAqACoAKgAqACoAKgAqACoAKgAqACoAKgAqACoAKgBcAEsASwBLAEsASwBLAEsASwBLAEsADQANAB4AHgAeAB4AXABcAFwAXABcAFwAKgAqACoAKgBcAFwAXABcACoAKgAqAFwAKgAqACoAXABcACoAKgAqACoAKgAqACoAXABcAFwAKgAqACoAKgBcAFwAXABcAFwAXABcAFwAXABcAFwAXABcACoAKgAqACoAKgAqACoAKgAqACoAKgAqAFwAKgBLAEsASwBLAEsASwBLAEsASwBLACoAKgAqACoAKgAqAFAAUABQAFAAUABQACsAUAArACsAKwArACsAUAArACsAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAHgBQAFAAUABQAFgAWABYAFgAWABYAFgAWABYAFgAWABYAFgAWABYAFgAWABYAFgAWABYAFgAWABYAFgAWABYAFgAWABYAFgAWABZAFkAWQBZAFkAWQBZAFkAWQBZAFkAWQBZAFkAWQBZAFkAWQBZAFkAWQBZAFkAWQBZAFkAWQBZAFkAWQBZAFkAWgBaAFoAWgBaAFoAWgBaAFoAWgBaAFoAWgBaAFoAWgBaAFoAWgBaAFoAWgBaAFoAWgBaAFoAWgBaAFoAWgBaAFAAUABQAFAAUABQAFAAUABQACsAUABQAFAAUAArACsAUABQAFAAUABQAFAAUAArAFAAKwBQAFAAUABQACsAKwBQAFAAUABQAFAAUABQAFAAUAArAFAAUABQAFAAKwArAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAArAFAAUABQAFAAKwArAFAAUABQAFAAUABQAFAAKwBQACsAUABQAFAAUAArACsAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAKwBQAFAAUABQACsAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAArACsABAAEAAQAHgANAB4AHgAeAB4AHgAeAB4AUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQACsAKwArAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAHgAeAB4AHgAeAB4AHgAeAB4AHgArACsAKwArACsAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQACsAKwBQAFAAUABQAFAAUAArACsADQBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAHgAeAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAANAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAAWABEAKwArACsAUABQAFAAUABQAFAAUABQAFAAUABQAA0ADQANAFAAUABQAFAAUABQAFAAUABQAFAAUAArACsAKwArACsAKwArAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAKwBQAFAAUABQAAQABAAEACsAKwArACsAKwArACsAKwArACsAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAAEAAQABAANAA0AKwArACsAKwArACsAKwArACsAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAABAAEACsAKwArACsAKwArACsAKwArACsAKwArAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAKwBQAFAAUAArAAQABAArACsAKwArACsAKwArACsAKwArACsAKwBcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAKgAqACoAKgAqACoAKgAqACoAKgAqACoAKgAqACoAKgAqACoAKgAqAA0ADQAVAFwADQAeAA0AGwBcACoAKwArAEsASwBLAEsASwBLAEsASwBLAEsAKwArACsAKwArACsAUABQAFAAUABQAFAAUABQAFAAUAArACsAKwArACsAKwAeAB4AEwATAA0ADQAOAB4AEwATAB4ABAAEAAQACQArAEsASwBLAEsASwBLAEsASwBLAEsAKwArACsAKwArACsAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAArACsAKwArACsAKwArAFAAUABQAFAAUAAEAAQAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAAQAUAArACsAKwArACsAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAArACsAKwArACsAKwArACsAKwArAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAKwAEAAQABAAEAAQABAAEAAQABAAEAAQABAArACsAKwArAAQABAAEAAQABAAEAAQABAAEAAQABAAEACsAKwArACsAHgArACsAKwATABMASwBLAEsASwBLAEsASwBLAEsASwBcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXAArACsAXABcAFwAXABcACsAKwArACsAKwArACsAKwArACsAKwBcAFwAXABcAFwAXABcAFwAXABcAFwAXAArACsAKwArAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcACsAKwArACsAKwArAEsASwBLAEsASwBLAEsASwBLAEsAXAArACsAKwAqACoAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAAQABAAEAAQABAArACsAHgAeAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcACoAKgAqACoAKgAqACoAKgAqACoAKwAqACoAKgAqACoAKgAqACoAKgAqACoAKgAqACoAKgAqACoAKgAqACoAKgAqACoAKgAqACoAKgAqACoAKwArAAQASwBLAEsASwBLAEsASwBLAEsASwArACsAKwArACsAKwBLAEsASwBLAEsASwBLAEsASwBLACsAKwArACsAKwArACoAKgAqACoAKgAqACoAXAAqACoAKgAqACoAKgArACsABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsABAAEAAQABAAEAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAAQABAAEAAQABABQAFAAUABQAFAAUABQACsAKwArACsASwBLAEsASwBLAEsASwBLAEsASwANAA0AHgANAA0ADQANAB4AHgAeAB4AHgAeAB4AHgAeAB4ABAAEAAQABAAEAAQABAAEAAQAHgAeAB4AHgAeAB4AHgAeAB4AKwArACsABAAEAAQAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAABAAEAAQABAAEAAQABAAEAAQABAAEAAQABABQAFAASwBLAEsASwBLAEsASwBLAEsASwBQAFAAUABQAFAAUABQAFAABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEACsAKwArACsAKwArACsAKwAeAB4AHgAeAFAAUABQAFAABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEACsAKwArAA0ADQANAA0ADQBLAEsASwBLAEsASwBLAEsASwBLACsAKwArAFAAUABQAEsASwBLAEsASwBLAEsASwBLAEsAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAA0ADQBQAFAAUABQAFAAUABQAFAAUAArACsAKwArACsAKwArAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQACsAKwBQAFAAUAAeAB4AHgAeAB4AHgAeAB4AKwArACsAKwArACsAKwArAAQABAAEAB4ABAAEAAQABAAEAAQABAAEAAQABAAEAAQABABQAFAAUABQAAQAUABQAFAAUABQAFAABABQAFAABAAEAAQAUAArACsAKwArACsABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEACsABAAEAAQABAAEAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AKwArAFAAUABQAFAAUABQACsAKwBQAFAAUABQAFAAUABQAFAAKwBQACsAUAArAFAAKwAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeACsAKwAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgArAB4AHgAeAB4AHgAeAB4AHgBQAB4AHgAeAFAAUABQACsAHgAeAB4AHgAeAB4AHgAeAB4AHgBQAFAAUABQACsAKwAeAB4AHgAeAB4AHgArAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AKwArAFAAUABQACsAHgAeAB4AHgAeAB4AHgAOAB4AKwANAA0ADQANAA0ADQANAAkADQANAA0ACAAEAAsABAAEAA0ACQANAA0ADAAdAB0AHgAXABcAFgAXABcAFwAWABcAHQAdAB4AHgAUABQAFAANAAEAAQAEAAQABAAEAAQACQAaABoAGgAaABoAGgAaABoAHgAXABcAHQAVABUAHgAeAB4AHgAeAB4AGAAWABEAFQAVABUAHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4ADQAeAA0ADQANAA0AHgANAA0ADQAHAB4AHgAeAB4AKwAEAAQABAAEAAQABAAEAAQABAAEAFAAUAArACsATwBQAFAAUABQAFAAHgAeAB4AFgARAE8AUABPAE8ATwBPAFAAUABQAFAAUAAeAB4AHgAWABEAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQACsAKwArABsAGwAbABsAGwAbABsAGgAbABsAGwAbABsAGwAbABsAGwAbABsAGwAbABsAGgAbABsAGwAbABoAGwAbABoAGwAbABsAGwAbABsAGwAbABsAGwAbABsAGwAbABsAGwAbAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQAHgAeAFAAGgAeAB0AHgBQAB4AGgAeAB4AHgAeAB4AHgAeAB4AHgBPAB4AUAAbAB4AHgBQAFAAUABQAFAAHgAeAB4AHQAdAB4AUAAeAFAAHgBQAB4AUABPAFAAUAAeAB4AHgAeAB4AHgAeAFAAUABQAFAAUAAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAFAAHgBQAFAAUABQAE8ATwBQAFAAUABQAFAATwBQAFAATwBQAE8ATwBPAE8ATwBPAE8ATwBPAE8ATwBPAFAAUABQAFAATwBPAE8ATwBPAE8ATwBPAE8ATwBQAFAAUABQAFAAUABQAFAAUAAeAB4AUABQAFAAUABPAB4AHgArACsAKwArAB0AHQAdAB0AHQAdAB0AHQAdAB0AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB0AHgAdAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAdAB4AHQAdAB4AHgAeAB0AHQAeAB4AHQAeAB4AHgAdAB4AHQAbABsAHgAdAB4AHgAeAB4AHQAeAB4AHQAdAB0AHQAeAB4AHQAeAB0AHgAdAB0AHQAdAB0AHQAeAB0AHgAeAB4AHgAeAB0AHQAdAB0AHgAeAB4AHgAdAB0AHgAeAB4AHgAeAB4AHgAeAB4AHgAdAB4AHgAeAB0AHgAeAB4AHgAeAB0AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAdAB0AHgAeAB0AHQAdAB0AHgAeAB0AHQAeAB4AHQAdAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB0AHQAeAB4AHQAdAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHQAeAB4AHgAdAB4AHgAeAB4AHgAeAB4AHQAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB0AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AFAAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeABYAEQAWABEAHgAeAB4AHgAeAB4AHQAeAB4AHgAeAB4AHgAeACUAJQAeAB4AHgAeAB4AHgAeAB4AHgAWABEAHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AJQAlACUAJQAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArAE8ATwBPAE8ATwBPAE8ATwBPAE8ATwBPAE8ATwBPAE8ATwBPAE8ATwBPAE8ATwBPAE8ATwBPAE8ATwBPAE8ATwAdAB0AHQAdAB0AHQAdAB0AHQAdAB0AHQAdAB0AHQAdAB0AHQAdAB0AHQAdAB0AHQAdAB0AHQAdAB0AHQAdAB0AHQAdAE8ATwBPAE8ATwBPAE8ATwBPAE8ATwBPAE8ATwBPAE8ATwBPAE8ATwBPAFAAHQAdAB0AHQAdAB0AHQAdAB0AHQAdAB0AHgAeAB4AHgAdAB0AHQAdAB0AHQAdAB0AHQAdAB0AHQAdAB0AHQAdAB0AHQAdAB0AHQAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHQAdAB0AHQAdAB0AHQAdAB0AHQAdAB0AHQAdAB0AHQAeAB4AHQAdAB0AHQAeAB4AHgAeAB4AHgAeAB4AHgAeAB0AHQAeAB0AHQAdAB0AHQAdAB0AHgAeAB4AHgAeAB4AHgAeAB0AHQAeAB4AHQAdAB4AHgAeAB4AHQAdAB4AHgAeAB4AHQAdAB0AHgAeAB0AHgAeAB0AHQAdAB0AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAdAB0AHQAdAB4AHgAeAB4AHgAeAB4AHgAeAB0AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAlACUAJQAlAB4AHQAdAB4AHgAdAB4AHgAeAB4AHQAdAB4AHgAeAB4AJQAlAB0AHQAlAB4AJQAlACUAIAAlACUAHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAlACUAJQAeAB4AHgAeAB0AHgAdAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAdAB0AHgAdAB0AHQAeAB0AJQAdAB0AHgAdAB0AHgAdAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeACUAHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHQAdAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAlACUAJQAlACUAJQAlACUAJQAlACUAJQAdAB0AHQAdACUAHgAlACUAJQAdACUAJQAdAB0AHQAlACUAHQAdACUAHQAdACUAJQAlAB4AHQAeAB4AHgAeAB0AHQAlAB0AHQAdAB0AHQAdACUAJQAlACUAJQAdACUAJQAgACUAHQAdACUAJQAlACUAJQAlACUAJQAeAB4AHgAlACUAIAAgACAAIAAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB0AHgAeAB4AFwAXABcAFwAXABcAHgATABMAJQAeAB4AHgAWABEAFgARABYAEQAWABEAFgARABYAEQAWABEATwBPAE8ATwBPAE8ATwBPAE8ATwBPAE8ATwBPAE8ATwBPAE8ATwBPAE8ATwAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeABYAEQAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAWABEAFgARABYAEQAWABEAFgARAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AFgARABYAEQAWABEAFgARABYAEQAWABEAFgARABYAEQAWABEAFgARABYAEQAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAWABEAFgARAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AFgARAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAdAB0AHQAdAB0AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgArACsAHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AKwAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AUABQAFAAUAAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAEAAQABAAeAB4AKwArACsAKwArABMADQANAA0AUAATAA0AUABQAFAAUABQAFAAUABQACsAKwArACsAKwArACsAUAANACsAKwArACsAKwArACsAKwArACsAKwArACsAKwAEAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAArACsAKwArACsAKwArACsAKwBQAFAAUABQAFAAUABQACsAUABQAFAAUABQAFAAUAArAFAAUABQAFAAUABQAFAAKwBQAFAAUABQAFAAUABQACsAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXAA0ADQANAA0ADQANAA0ADQAeAA0AFgANAB4AHgAXABcAHgAeABcAFwAWABEAFgARABYAEQAWABEADQANAA0ADQATAFAADQANAB4ADQANAB4AHgAeAB4AHgAMAAwADQANAA0AHgANAA0AFgANAA0ADQANAA0ADQANAA0AHgANAB4ADQANAB4AHgAeACsAKwArACsAKwArACsAKwArACsAKwArACsAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACsAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAKwArACsAKwArACsAKwArACsAKwArACsAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwAlACUAJQAlACUAJQAlACUAJQAlACUAJQArACsAKwArAA0AEQARACUAJQBHAFcAVwAWABEAFgARABYAEQAWABEAFgARACUAJQAWABEAFgARABYAEQAWABEAFQAWABEAEQAlAFcAVwBXAFcAVwBXAFcAVwBXAAQABAAEAAQABAAEACUAVwBXAFcAVwA2ACUAJQBXAFcAVwBHAEcAJQAlACUAKwBRAFcAUQBXAFEAVwBRAFcAUQBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFEAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBRAFcAUQBXAFEAVwBXAFcAVwBXAFcAUQBXAFcAVwBXAFcAVwBRAFEAKwArAAQABAAVABUARwBHAFcAFQBRAFcAUQBXAFEAVwBRAFcAUQBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFEAVwBRAFcAUQBXAFcAVwBXAFcAVwBRAFcAVwBXAFcAVwBXAFEAUQBXAFcAVwBXABUAUQBHAEcAVwArACsAKwArACsAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAKwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAKwAlACUAVwBXAFcAVwAlACUAJQAlACUAJQAlACUAJQAlACsAKwArACsAKwArACsAKwArACsAKwArAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAUQBRAFEAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQArAFcAVwBXAFcAVwBXAFcAVwBXAFcAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQBPAE8ATwBPAE8ATwBPAE8AJQBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXACUAJQAlAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAEcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAKwArACsAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQArACsAKwArACsAKwArACsAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAADQATAA0AUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABLAEsASwBLAEsASwBLAEsASwBLAFAAUAArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAFAABAAEAAQABAAeAAQABAAEAAQABAAEAAQABAAEAAQAHgBQAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AUABQAAQABABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAAQABAAeAA0ADQANAA0ADQArACsAKwArACsAKwArACsAHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAFAAUABQAFAAUABQAFAAUABQAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AUAAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgBQAB4AHgAeAB4AHgAeAFAAHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgArACsAHgAeAB4AHgAeAB4AHgAeAB4AKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwAeAB4AUABQAFAAUABQAFAAUABQAFAAUABQAAQAUABQAFAABABQAFAAUABQAAQAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAAQABAAEAAQABAAeAB4AHgAeAAQAKwArACsAUABQAFAAUABQAFAAHgAeABoAHgArACsAKwArACsAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAADgAOABMAEwArACsAKwArACsAKwArACsABAAEAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAAQABAAEAAQABAAEACsAKwArACsAKwArACsAKwANAA0ASwBLAEsASwBLAEsASwBLAEsASwArACsAKwArACsAKwAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABABQAFAAUABQAFAAUAAeAB4AHgBQAA4AUABQAAQAUABQAFAAUABQAFAABAAEAAQABAAEAAQABAAEAA0ADQBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQAKwArACsAKwArACsAKwArACsAKwArAB4AWABYAFgAWABYAFgAWABYAFgAWABYAFgAWABYAFgAWABYAFgAWABYAFgAWABYAFgAWABYAFgAWABYACsAKwArAAQAHgAeAB4AHgAeAB4ADQANAA0AHgAeAB4AHgArAFAASwBLAEsASwBLAEsASwBLAEsASwArACsAKwArAB4AHgBcAFwAXABcAFwAKgBcAFwAXABcAFwAXABcAFwAXABcAEsASwBLAEsASwBLAEsASwBLAEsAXABcAFwAXABcACsAUABQAFAAUABQAFAAUABQAFAABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEACsAKwArACsAKwArACsAKwArAFAAUABQAAQAUABQAFAAUABQAFAAUABQAAQABAArACsASwBLAEsASwBLAEsASwBLAEsASwArACsAHgANAA0ADQBcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAKgAqACoAXAAqACoAKgBcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXAAqAFwAKgAqACoAXABcACoAKgBcAFwAXABcAFwAKgAqAFwAKgBcACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArAFwAXABcACoAKgBQAFAAUABQAFAAUABQAFAAUABQAFAABAAEAAQABAAEAA0ADQBQAFAAUAAEAAQAKwArACsAKwArACsAKwArACsAKwBQAFAAUABQAFAAUAArACsAUABQAFAAUABQAFAAKwArAFAAUABQAFAAUABQACsAKwArACsAKwArACsAKwArAFAAUABQAFAAUABQAFAAKwBQAFAAUABQAFAAUABQACsAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAHgAeACsAKwArACsAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAAEAAQABAAEAAQABAAEAAQADQAEAAQAKwArAEsASwBLAEsASwBLAEsASwBLAEsAKwArACsAKwArACsAVABVAFUAVQBVAFUAVQBVAFUAVQBVAFUAVQBVAFUAVQBVAFUAVQBVAFUAVQBVAFUAVQBVAFUAVQBUAFUAVQBVAFUAVQBVAFUAVQBVAFUAVQBVAFUAVQBVAFUAVQBVAFUAVQBVAFUAVQBVAFUAVQBVACsAKwArACsAKwArACsAKwArACsAKwArAFkAWQBZAFkAWQBZAFkAWQBZAFkAWQBZAFkAWQBZAFkAWQBZAFkAKwArACsAKwBaAFoAWgBaAFoAWgBaAFoAWgBaAFoAWgBaAFoAWgBaAFoAWgBaAFoAWgBaAFoAWgBaAFoAWgBaAFoAKwArACsAKwAGAAYABgAGAAYABgAGAAYABgAGAAYABgAGAAYABgAGAAYABgAGAAYABgAGAAYABgAGAAYABgAGAAYABgAGAAYAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXACUAJQBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAJQAlACUAJQAlACUAUABQAFAAUABQAFAAUAArACsAKwArACsAKwArACsAKwArACsAKwBQAFAAUABQAFAAKwArACsAKwArAFYABABWAFYAVgBWAFYAVgBWAFYAVgBWAB4AVgBWAFYAVgBWAFYAVgBWAFYAVgBWAFYAVgArAFYAVgBWAFYAVgArAFYAKwBWAFYAKwBWAFYAKwBWAFYAVgBWAFYAVgBWAFYAVgBWAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAEQAWAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAKwArAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUAAaAB4AKwArAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQAGAARABEAGAAYABMAEwAWABEAFAArACsAKwArACsAKwAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEACUAJQAlACUAJQAWABEAFgARABYAEQAWABEAFgARABYAEQAlACUAFgARACUAJQAlACUAJQAlACUAEQAlABEAKwAVABUAEwATACUAFgARABYAEQAWABEAJQAlACUAJQAlACUAJQAlACsAJQAbABoAJQArACsAKwArAFAAUABQAFAAUAArAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAKwArAAcAKwATACUAJQAbABoAJQAlABYAEQAlACUAEQAlABEAJQBXAFcAVwBXAFcAVwBXAFcAVwBXABUAFQAlACUAJQATACUAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXABYAJQARACUAJQAlAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwAWACUAEQAlABYAEQARABYAEQARABUAVwBRAFEAUQBRAFEAUQBRAFEAUQBRAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAEcARwArACsAVwBXAFcAVwBXAFcAKwArAFcAVwBXAFcAVwBXACsAKwBXAFcAVwBXAFcAVwArACsAVwBXAFcAKwArACsAGgAbACUAJQAlABsAGwArAB4AHgAeAB4AHgAeAB4AKwArACsAKwArACsAKwArACsAKwAEAAQABAAQAB0AKwArAFAAUABQAFAAUABQAFAAUABQAFAAUABQACsAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAArAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAKwBQAFAAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAArACsAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQACsAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAArACsAKwArACsADQANAA0AKwArACsAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQACsAKwArAB4AHgAeAB4AHgAeAB4AHgAeAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgBQAFAAHgAeAB4AKwAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAAQAKwArAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwAEAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQACsAKwArACsAKwArACsAKwArAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAKwArACsAKwArAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAABAAEAAQABAAEACsAKwArACsAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAArAA0AUABQAFAAUAArACsAKwArAFAAUABQAFAAUABQAFAAUAANAFAAUABQAFAAUAArACsAKwArACsAKwArACsAKwArAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQACsAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAKwArACsAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQACsAKwArACsAKwArACsAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQACsAKwArACsAKwArACsAKwArACsAKwAeACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAUABQAFAAUABQAFAAKwArAFAAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAArAFAAUAArACsAKwBQACsAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAKwANAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAAeAB4AUABQAFAAUABQAFAAUAArACsAKwArACsAKwArAFAAUABQAFAAUABQAFAAUABQACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAArAFAAUAArACsAKwArACsAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQACsAKwArAA0AUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQACsAKwArACsAKwAeAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQACsAKwArACsAUABQAFAAUABQAAQABAAEACsABAAEACsAKwArACsAKwAEAAQABAAEAFAAUABQAFAAKwBQAFAAUAArAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAKwArAAQABAAEACsAKwArACsABABQAFAAUABQAFAAUABQAFAAUAArACsAKwArACsAKwArAA0ADQANAA0ADQANAA0ADQAeACsAKwArACsAKwArACsAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAAeAFAAUABQAFAAUABQAFAAUAAeAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAAQABAArACsAKwArAFAAUABQAFAAUAANAA0ADQANAA0ADQAUACsAKwArACsAKwArACsAKwArAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAKwArACsADQANAA0ADQANAA0ADQBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAArACsAKwArACsAKwArAB4AHgAeAB4AKwArACsAKwArACsAKwArACsAKwArACsAUABQAFAAUABQAFAAUAArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArAFAAUABQAFAAUABQAFAAUABQACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQACsAKwArACsAKwArACsAKwArACsAKwArACsAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAArACsAKwArACsAKwArAFAAUABQAFAAUABQAAQABAAEAAQAKwArACsAKwArACsAKwArAEsASwBLAEsASwBLAEsASwBLAEsAKwArACsAKwArACsAUABQAFAAUABQAFAAUABQAFAAUAArAAQABAANACsAKwBQAFAAKwArACsAKwArACsAKwArACsAKwArACsAKwArAFAAUABQAFAAUABQAAQABAAEAAQABAAEAAQABAAEAAQABABQAFAAUABQAB4AHgAeAB4AHgArACsAKwArACsAKwAEAAQABAAEAAQABAAEAA0ADQAeAB4AHgAeAB4AKwArACsAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAEsASwBLAEsASwBLAEsASwBLAEsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsABABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAAQABAAEAAQABAAEAAQABAAEAAQABAAeAB4AHgANAA0ADQANACsAKwArACsAKwArACsAKwArACsAKwAeACsAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAKwArACsAKwArACsAKwBLAEsASwBLAEsASwBLAEsASwBLACsAKwArACsAKwArAFAAUABQAFAAUABQAFAABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEACsASwBLAEsASwBLAEsASwBLAEsASwANAA0ADQANAFAABAAEAFAAKwArACsAKwArACsAKwArAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAABAAeAA4AUAArACsAKwArACsAKwArACsAKwAEAFAAUABQAFAADQANAB4ADQAEAAQABAAEAB4ABAAEAEsASwBLAEsASwBLAEsASwBLAEsAUAAOAFAADQANAA0AKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAKwArACsAKwArACsAKwArACsAKwArAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQACsAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAAEAAQABAAEAAQABAAEAAQABAAEAAQABAANAA0AHgANAA0AHgAEACsAUABQAFAAUABQAFAAUAArAFAAKwBQAFAAUABQACsAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAKwBQAFAAUABQAFAAUABQAFAAUABQAA0AKwArACsAKwArACsAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAAEAAQABAAEAAQABAAEAAQABAAEAAQAKwArACsAKwArAEsASwBLAEsASwBLAEsASwBLAEsAKwArACsAKwArACsABAAEAAQABAArAFAAUABQAFAAUABQAFAAUAArACsAUABQACsAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAKwBQAFAAUABQAFAAUABQACsAUABQACsAUABQAFAAUABQACsABAAEAFAABAAEAAQABAAEAAQABAArACsABAAEACsAKwAEAAQABAArACsAUAArACsAKwArACsAKwAEACsAKwArACsAKwBQAFAAUABQAFAABAAEACsAKwAEAAQABAAEAAQABAAEACsAKwArAAQABAAEAAQABAArACsAKwArACsAKwArACsAKwArACsABAAEAAQABAAEAAQABABQAFAAUABQAA0ADQANAA0AHgBLAEsASwBLAEsASwBLAEsASwBLAA0ADQArAB4ABABQAFAAUAArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwAEAAQABAAEAFAAUAAeAFAAKwArACsAKwArACsAKwArAEsASwBLAEsASwBLAEsASwBLAEsAKwArACsAKwArACsAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAABAAEAAQABAAEAAQABAArACsABAAEAAQABAAEAAQABAAEAAQADgANAA0AEwATAB4AHgAeAA0ADQANAA0ADQANAA0ADQANAA0ADQANAA0ADQANAFAAUABQAFAABAAEACsAKwAEAA0ADQAeAFAAKwArACsAKwArACsAKwArACsAKwArAEsASwBLAEsASwBLAEsASwBLAEsAKwArACsAKwArACsADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArAFAAUABQAFAAUABQAFAAUABQAFAAUAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAFAAKwArACsAKwArACsAKwBLAEsASwBLAEsASwBLAEsASwBLACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAKwArACoAKgAqACoAKgAqACoAKgAqACoAKgAqACoAKgAqACsAKwArACsASwBLAEsASwBLAEsASwBLAEsASwBcAFwADQANAA0AKgBQAFAAUABQAFAAUABQAFAAUABQAFAAUAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAeACsAKwArACsASwBLAEsASwBLAEsASwBLAEsASwBQAFAAUABQAFAAUABQAFAAUAArACsAKwArACsAKwArACsAKwArACsAKwBQAFAAUABQAFAAUABQAFAAKwArAFAAKwArAFAAUABQAFAAUABQAFAAUAArAFAAUAArAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAABAAEAAQABAAEAAQAKwAEAAQAKwArAAQABAAEAAQAUAAEAFAABAAEAA0ADQANACsAKwArACsAKwArACsAKwArAEsASwBLAEsASwBLAEsASwBLAEsAKwArACsAKwArACsAUABQAFAAUABQAFAAUABQACsAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAABAAEAAQABAAEAAQABAArACsABAAEAAQABAAEAAQABABQAA4AUAAEACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArAFAABAAEAAQABAAEAAQABAAEAAQABABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAAEAAQABAAEAAQABAAEAFAABAAEAAQABAAOAB4ADQANAA0ADQAOAB4ABAArACsAKwArACsAKwArACsAUAAEAAQABAAEAAQABAAEAAQABAAEAAQAUABQAFAAUABQAFAAUABQAFAAUAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAA0ADQANAFAADgAOAA4ADQANACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwBQAFAAUABQAFAAUABQAFAAUAArAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAABAAEAAQABAAEAAQABAAEACsABAAEAAQABAAEAAQABAAEAFAADQANAA0ADQANACsAKwArACsAKwArACsAKwArACsASwBLAEsASwBLAEsASwBLAEsASwBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAArACsAKwAOABMAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAKwArAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAArAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAArACsAKwArACsAKwArACsAKwBQAFAAUABQAFAAUABQACsAUABQACsAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAAEAAQABAAEAAQABAArACsAKwAEACsABAAEACsABAAEAAQABAAEAAQABABQAAQAKwArACsAKwArACsAKwArAEsASwBLAEsASwBLAEsASwBLAEsAKwArACsAKwArACsAUABQAFAAUABQAFAAKwBQAFAAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAAEAAQABAAEAAQAKwAEAAQAKwAEAAQABAAEAAQAUAArACsAKwArACsAKwArAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAABAAEAAQABAAeAB4AKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwBQACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAB4AHgAeAB4AHgAeAB4AHgAaABoAGgAaAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgArACsAKwArACsAKwArACsAKwArACsAKwArAA0AUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQACsAKwArACsAKwArAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQACsADQANAA0ADQANACsAKwArACsAKwArACsAKwArACsAKwBQAFAAUABQACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAASABIAEgAQwBDAEMAUABQAFAAUABDAFAAUABQAEgAQwBIAEMAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAASABDAEMAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAKwAJAAkACQAJAAkACQAJABYAEQArACsAKwArACsAKwArAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABIAEMAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArAEsASwBLAEsASwBLAEsASwBLAEsAKwArACsAKwANAA0AKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAKwArAAQABAAEAAQABAANACsAKwArACsAKwArACsAKwArACsAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAAEAAQABAAEAAQABAAEAA0ADQANAB4AHgAeAB4AHgAeAFAAUABQAFAADQAeACsAKwArACsAKwArACsAKwArACsASwBLAEsASwBLAEsASwBLAEsASwArAFAAUABQAFAAUABQAFAAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAArACsAKwArACsAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAANAA0AHgAeACsAKwArACsAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAKwArACsAKwAEAFAABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQAKwArACsAKwArACsAKwAEAAQABAAEAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAARwBHABUARwAJACsAKwArACsAKwArACsAKwArACsAKwAEAAQAKwArACsAKwArACsAKwArACsAKwArACsAKwArAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXACsAKwArACsAKwArACsAKwBXAFcAVwBXAFcAVwBXAFcAVwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAUQBRAFEAKwArACsAKwArACsAKwArACsAKwArACsAKwBRAFEAUQBRACsAKwArACsAKwArACsAKwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXACsAKwArACsAUABQAFAAUABQAFAAUABQAFAAUABQACsAKwArACsAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQACsAKwArACsAKwArACsAUABQAFAAUABQAFAAUABQAFAAUAArACsAHgAEAAQADQAEAAQABAAEACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgArACsAKwArACsAKwArACsAKwArAB4AHgAeAB4AHgAeAB4AKwArAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAAQABAAEAAQABAAeAB4AHgAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAB4AHgAEAAQABAAEAAQABAAEAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4ABAAEAAQABAAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4ABAAEAAQAHgArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQACsAKwArACsAKwArACsAKwArACsAKwArAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgArACsAKwArACsAKwArACsAKwAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgArAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AKwBQAFAAKwArAFAAKwArAFAAUAArACsAUABQAFAAUAArAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeACsAUAArAFAAUABQAFAAUABQAFAAKwAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AKwBQAFAAUABQACsAKwBQAFAAUABQAFAAUABQAFAAKwBQAFAAUABQAFAAUABQACsAHgAeAFAAUABQAFAAUAArAFAAKwArACsAUABQAFAAUABQAFAAUAArAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AKwArAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAHgBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgBQAFAAUABQAFAAUABQAFAAUABQAFAAHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAB4AHgAeAB4AHgAeAB4AHgAeACsAKwBLAEsASwBLAEsASwBLAEsASwBLAEsASwBLAEsASwBLAEsASwBLAEsASwBLAEsASwBLAEsASwBLAEsASwBLAEsASwBLAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAeAB4AHgAeAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAeAB4AHgAeAB4AHgAeAB4ABAAeAB4AHgAeAB4AHgAeAB4AHgAeAAQAHgAeAA0ADQANAA0AHgArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwAEAAQABAAEAAQAKwAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArAAQABAAEAAQABAAEAAQAKwAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQAKwArAAQABAAEAAQABAAEAAQAKwAEAAQAKwAEAAQABAAEAAQAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAArACsAKwAEAAQABAAEAAQABAAEAFAAUABQAFAAUABQAFAAKwArAEsASwBLAEsASwBLAEsASwBLAEsAKwArACsAKwBQAB4AKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUAAEAAQABAAEAEsASwBLAEsASwBLAEsASwBLAEsAKwArACsAKwArABsAUABQAFAAUABQACsAKwBQAFAAUABQAFAAUABQAFAAUAAEAAQABAAEAAQABAAEACsAKwArACsAKwArACsAKwArAB4AHgAeAB4ABAAEAAQABAAEAAQABABQACsAKwArACsASwBLAEsASwBLAEsASwBLAEsASwArACsAKwArABYAFgArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAGgBQAFAAUAAaAFAAUABQAFAAKwArACsAKwArACsAKwArACsAKwArAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAAeAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQACsAKwBQAFAAUABQACsAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAKwBQAFAAKwBQACsAKwBQACsAUABQAFAAUABQAFAAUABQAFAAUAArAFAAUABQAFAAKwBQACsAUAArACsAKwArACsAKwBQACsAKwArACsAUAArAFAAKwBQACsAUABQAFAAKwBQAFAAKwBQACsAKwBQACsAUAArAFAAKwBQACsAUAArAFAAUAArAFAAKwArAFAAUABQAFAAKwBQAFAAUABQAFAAUABQACsAUABQAFAAUAArAFAAUABQAFAAKwBQACsAUABQAFAAUABQAFAAUABQAFAAUAArAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAArACsAKwArACsAUABQAFAAKwBQAFAAUABQAFAAKwBQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwAeAB4AKwArACsAKwArACsAKwArACsAKwArACsAKwArAE8ATwBPAE8ATwBPAE8ATwBPAE8ATwBPAE8AJQAlACUAHQAdAB0AHQAdAB0AHQAdAB0AHQAdAB0AHQAdAB0AHQAdAB0AHgAeAB0AHQAdAB0AHQAdAB0AHQAdAB0AHQAdAB0AHQAdAB0AHQAdAB4AHgAeACUAJQAlAB0AHQAdAB0AHQAdAB0AHQAdAB0AHQAdAB0AHQAdAB0AHQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQApACkAKQApACkAKQApACkAKQApACkAKQApACkAKQApACkAKQApACkAKQApACkAKQApACkAJQAlACUAJQAlACAAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAeAB4AJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlAB4AHgAlACUAJQAlACUAHgAlACUAJQAlACUAIAAgACAAJQAlACAAJQAlACAAIAAgACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACEAIQAhACEAIQAlACUAIAAgACUAJQAgACAAIAAgACAAIAAgACAAIAAgACAAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAJQAlACUAIAAlACUAJQAlACAAIAAgACUAIAAgACAAJQAlACUAJQAlACUAJQAgACUAIAAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAHgAlAB4AJQAeACUAJQAlACUAJQAgACUAJQAlACUAHgAlAB4AHgAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlAB4AHgAeAB4AHgAeAB4AJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAeAB4AHgAeAB4AHgAeAB4AHgAeACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACAAIAAlACUAJQAlACAAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACAAJQAlACUAJQAgACAAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAHgAeAB4AHgAeAB4AHgAeACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAeAB4AHgAeAB4AHgAlACUAJQAlACUAJQAlACAAIAAgACUAJQAlACAAIAAgACAAIAAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeABcAFwAXABUAFQAVAB4AHgAeAB4AJQAlACUAIAAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACAAIAAgACUAJQAlACUAJQAlACUAJQAlACAAJQAlACUAJQAlACUAJQAlACUAJQAlACAAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AJQAlACUAJQAlACUAJQAlACUAJQAlACUAHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AJQAlACUAJQAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeACUAJQAlACUAJQAlACUAJQAeAB4AHgAeAB4AHgAeAB4AHgAeACUAJQAlACUAJQAlAB4AHgAeAB4AHgAeAB4AHgAlACUAJQAlACUAJQAlACUAHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAgACUAJQAgACUAJQAlACUAJQAlACUAJQAgACAAIAAgACAAIAAgACAAJQAlACUAJQAlACUAIAAlACUAJQAlACUAJQAlACUAJQAgACAAIAAgACAAIAAgACAAIAAgACUAJQAgACAAIAAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAgACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACAAIAAlACAAIAAlACAAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAgACAAIAAlACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAJQAlAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AKwAeAB4AHgAeAB4AHgAeAB4AHgAeAB4AHgArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArAEsASwBLAEsASwBLAEsASwBLAEsAKwArACsAKwArACsAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAKwArAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXACUAJQBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwAlACUAJQAlACUAJQAlACUAJQAlACUAVwBXACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQBXAFcAVwBXAFcAVwBXAFcAVwBXAFcAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAJQAlACUAKwAEACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArACsAKwArAA==';

		    var LETTER_NUMBER_MODIFIER = 50;
		    // Non-tailorable Line Breaking Classes
		    var BK = 1; //  Cause a line break (after)
		    var CR$1 = 2; //  Cause a line break (after), except between CR and LF
		    var LF$1 = 3; //  Cause a line break (after)
		    var CM = 4; //  Prohibit a line break between the character and the preceding character
		    var NL = 5; //  Cause a line break (after)
		    var WJ = 7; //  Prohibit line breaks before and after
		    var ZW = 8; //  Provide a break opportunity
		    var GL = 9; //  Prohibit line breaks before and after
		    var SP = 10; // Enable indirect line breaks
		    var ZWJ$1 = 11; // Prohibit line breaks within joiner sequences
		    // Break Opportunities
		    var B2 = 12; //  Provide a line break opportunity before and after the character
		    var BA = 13; //  Generally provide a line break opportunity after the character
		    var BB = 14; //  Generally provide a line break opportunity before the character
		    var HY = 15; //  Provide a line break opportunity after the character, except in numeric context
		    var CB = 16; //   Provide a line break opportunity contingent on additional information
		    // Characters Prohibiting Certain Breaks
		    var CL = 17; //  Prohibit line breaks before
		    var CP = 18; //  Prohibit line breaks before
		    var EX = 19; //  Prohibit line breaks before
		    var IN = 20; //  Allow only indirect line breaks between pairs
		    var NS = 21; //  Allow only indirect line breaks before
		    var OP = 22; //  Prohibit line breaks after
		    var QU = 23; //  Act like they are both opening and closing
		    // Numeric Context
		    var IS = 24; //  Prevent breaks after any and before numeric
		    var NU = 25; //  Form numeric expressions for line breaking purposes
		    var PO = 26; //  Do not break following a numeric expression
		    var PR = 27; //  Do not break in front of a numeric expression
		    var SY = 28; //  Prevent a break before; and allow a break after
		    // Other Characters
		    var AI = 29; //  Act like AL when the resolvedEAW is N; otherwise; act as ID
		    var AL = 30; //  Are alphabetic characters or symbols that are used with alphabetic characters
		    var CJ = 31; //  Treat as NS or ID for strict or normal breaking.
		    var EB = 32; //  Do not break from following Emoji Modifier
		    var EM = 33; //  Do not break from preceding Emoji Base
		    var H2 = 34; //  Form Korean syllable blocks
		    var H3 = 35; //  Form Korean syllable blocks
		    var HL = 36; //  Do not break around a following hyphen; otherwise act as Alphabetic
		    var ID = 37; //  Break before or after; except in some numeric context
		    var JL = 38; //  Form Korean syllable blocks
		    var JV = 39; //  Form Korean syllable blocks
		    var JT = 40; //  Form Korean syllable blocks
		    var RI$1 = 41; //  Keep pairs together. For pairs; break before and after other classes
		    var SA = 42; //  Provide a line break opportunity contingent on additional, language-specific context analysis
		    var XX = 43; //  Have as yet unknown line breaking behavior or unassigned code positions
		    var ea_OP = [0x2329, 0xff08];
		    var BREAK_MANDATORY = '!';
		    var BREAK_NOT_ALLOWED$1 = '×';
		    var BREAK_ALLOWED$1 = '÷';
		    var UnicodeTrie$1 = createTrieFromBase64$1(base64$1);
		    var ALPHABETICS = [AL, HL];
		    var HARD_LINE_BREAKS = [BK, CR$1, LF$1, NL];
		    var SPACE$1 = [SP, ZW];
		    var PREFIX_POSTFIX = [PR, PO];
		    var LINE_BREAKS = HARD_LINE_BREAKS.concat(SPACE$1);
		    var KOREAN_SYLLABLE_BLOCK = [JL, JV, JT, H2, H3];
		    var HYPHEN = [HY, BA];
		    var codePointsToCharacterClasses = function (codePoints, lineBreak) {
		        if (lineBreak === void 0) { lineBreak = 'strict'; }
		        var types = [];
		        var indices = [];
		        var categories = [];
		        codePoints.forEach(function (codePoint, index) {
		            var classType = UnicodeTrie$1.get(codePoint);
		            if (classType > LETTER_NUMBER_MODIFIER) {
		                categories.push(true);
		                classType -= LETTER_NUMBER_MODIFIER;
		            }
		            else {
		                categories.push(false);
		            }
		            if (['normal', 'auto', 'loose'].indexOf(lineBreak) !== -1) {
		                // U+2010, – U+2013, 〜 U+301C, ゠ U+30A0
		                if ([0x2010, 0x2013, 0x301c, 0x30a0].indexOf(codePoint) !== -1) {
		                    indices.push(index);
		                    return types.push(CB);
		                }
		            }
		            if (classType === CM || classType === ZWJ$1) {
		                // LB10 Treat any remaining combining mark or ZWJ as AL.
		                if (index === 0) {
		                    indices.push(index);
		                    return types.push(AL);
		                }
		                // LB9 Do not break a combining character sequence; treat it as if it has the line breaking class of
		                // the base character in all of the following rules. Treat ZWJ as if it were CM.
		                var prev = types[index - 1];
		                if (LINE_BREAKS.indexOf(prev) === -1) {
		                    indices.push(indices[index - 1]);
		                    return types.push(prev);
		                }
		                indices.push(index);
		                return types.push(AL);
		            }
		            indices.push(index);
		            if (classType === CJ) {
		                return types.push(lineBreak === 'strict' ? NS : ID);
		            }
		            if (classType === SA) {
		                return types.push(AL);
		            }
		            if (classType === AI) {
		                return types.push(AL);
		            }
		            // For supplementary characters, a useful default is to treat characters in the range 10000..1FFFD as AL
		            // and characters in the ranges 20000..2FFFD and 30000..3FFFD as ID, until the implementation can be revised
		            // to take into account the actual line breaking properties for these characters.
		            if (classType === XX) {
		                if ((codePoint >= 0x20000 && codePoint <= 0x2fffd) || (codePoint >= 0x30000 && codePoint <= 0x3fffd)) {
		                    return types.push(ID);
		                }
		                else {
		                    return types.push(AL);
		                }
		            }
		            types.push(classType);
		        });
		        return [indices, types, categories];
		    };
		    var isAdjacentWithSpaceIgnored = function (a, b, currentIndex, classTypes) {
		        var current = classTypes[currentIndex];
		        if (Array.isArray(a) ? a.indexOf(current) !== -1 : a === current) {
		            var i = currentIndex;
		            while (i <= classTypes.length) {
		                i++;
		                var next = classTypes[i];
		                if (next === b) {
		                    return true;
		                }
		                if (next !== SP) {
		                    break;
		                }
		            }
		        }
		        if (current === SP) {
		            var i = currentIndex;
		            while (i > 0) {
		                i--;
		                var prev = classTypes[i];
		                if (Array.isArray(a) ? a.indexOf(prev) !== -1 : a === prev) {
		                    var n = currentIndex;
		                    while (n <= classTypes.length) {
		                        n++;
		                        var next = classTypes[n];
		                        if (next === b) {
		                            return true;
		                        }
		                        if (next !== SP) {
		                            break;
		                        }
		                    }
		                }
		                if (prev !== SP) {
		                    break;
		                }
		            }
		        }
		        return false;
		    };
		    var previousNonSpaceClassType = function (currentIndex, classTypes) {
		        var i = currentIndex;
		        while (i >= 0) {
		            var type = classTypes[i];
		            if (type === SP) {
		                i--;
		            }
		            else {
		                return type;
		            }
		        }
		        return 0;
		    };
		    var _lineBreakAtIndex = function (codePoints, classTypes, indicies, index, forbiddenBreaks) {
		        if (indicies[index] === 0) {
		            return BREAK_NOT_ALLOWED$1;
		        }
		        var currentIndex = index - 1;
		        if (Array.isArray(forbiddenBreaks) && forbiddenBreaks[currentIndex] === true) {
		            return BREAK_NOT_ALLOWED$1;
		        }
		        var beforeIndex = currentIndex - 1;
		        var afterIndex = currentIndex + 1;
		        var current = classTypes[currentIndex];
		        // LB4 Always break after hard line breaks.
		        // LB5 Treat CR followed by LF, as well as CR, LF, and NL as hard line breaks.
		        var before = beforeIndex >= 0 ? classTypes[beforeIndex] : 0;
		        var next = classTypes[afterIndex];
		        if (current === CR$1 && next === LF$1) {
		            return BREAK_NOT_ALLOWED$1;
		        }
		        if (HARD_LINE_BREAKS.indexOf(current) !== -1) {
		            return BREAK_MANDATORY;
		        }
		        // LB6 Do not break before hard line breaks.
		        if (HARD_LINE_BREAKS.indexOf(next) !== -1) {
		            return BREAK_NOT_ALLOWED$1;
		        }
		        // LB7 Do not break before spaces or zero width space.
		        if (SPACE$1.indexOf(next) !== -1) {
		            return BREAK_NOT_ALLOWED$1;
		        }
		        // LB8 Break before any character following a zero-width space, even if one or more spaces intervene.
		        if (previousNonSpaceClassType(currentIndex, classTypes) === ZW) {
		            return BREAK_ALLOWED$1;
		        }
		        // LB8a Do not break after a zero width joiner.
		        if (UnicodeTrie$1.get(codePoints[currentIndex]) === ZWJ$1) {
		            return BREAK_NOT_ALLOWED$1;
		        }
		        // zwj emojis
		        if ((current === EB || current === EM) && UnicodeTrie$1.get(codePoints[afterIndex]) === ZWJ$1) {
		            return BREAK_NOT_ALLOWED$1;
		        }
		        // LB11 Do not break before or after Word joiner and related characters.
		        if (current === WJ || next === WJ) {
		            return BREAK_NOT_ALLOWED$1;
		        }
		        // LB12 Do not break after NBSP and related characters.
		        if (current === GL) {
		            return BREAK_NOT_ALLOWED$1;
		        }
		        // LB12a Do not break before NBSP and related characters, except after spaces and hyphens.
		        if ([SP, BA, HY].indexOf(current) === -1 && next === GL) {
		            return BREAK_NOT_ALLOWED$1;
		        }
		        // LB13 Do not break before ‘]’ or ‘!’ or ‘;’ or ‘/’, even after spaces.
		        if ([CL, CP, EX, IS, SY].indexOf(next) !== -1) {
		            return BREAK_NOT_ALLOWED$1;
		        }
		        // LB14 Do not break after ‘[’, even after spaces.
		        if (previousNonSpaceClassType(currentIndex, classTypes) === OP) {
		            return BREAK_NOT_ALLOWED$1;
		        }
		        // LB15 Do not break within ‘”[’, even with intervening spaces.
		        if (isAdjacentWithSpaceIgnored(QU, OP, currentIndex, classTypes)) {
		            return BREAK_NOT_ALLOWED$1;
		        }
		        // LB16 Do not break between closing punctuation and a nonstarter (lb=NS), even with intervening spaces.
		        if (isAdjacentWithSpaceIgnored([CL, CP], NS, currentIndex, classTypes)) {
		            return BREAK_NOT_ALLOWED$1;
		        }
		        // LB17 Do not break within ‘——’, even with intervening spaces.
		        if (isAdjacentWithSpaceIgnored(B2, B2, currentIndex, classTypes)) {
		            return BREAK_NOT_ALLOWED$1;
		        }
		        // LB18 Break after spaces.
		        if (current === SP) {
		            return BREAK_ALLOWED$1;
		        }
		        // LB19 Do not break before or after quotation marks, such as ‘ ” ’.
		        if (current === QU || next === QU) {
		            return BREAK_NOT_ALLOWED$1;
		        }
		        // LB20 Break before and after unresolved CB.
		        if (next === CB || current === CB) {
		            return BREAK_ALLOWED$1;
		        }
		        // LB21 Do not break before hyphen-minus, other hyphens, fixed-width spaces, small kana, and other non-starters, or after acute accents.
		        if ([BA, HY, NS].indexOf(next) !== -1 || current === BB) {
		            return BREAK_NOT_ALLOWED$1;
		        }
		        // LB21a Don't break after Hebrew + Hyphen.
		        if (before === HL && HYPHEN.indexOf(current) !== -1) {
		            return BREAK_NOT_ALLOWED$1;
		        }
		        // LB21b Don’t break between Solidus and Hebrew letters.
		        if (current === SY && next === HL) {
		            return BREAK_NOT_ALLOWED$1;
		        }
		        // LB22 Do not break before ellipsis.
		        if (next === IN) {
		            return BREAK_NOT_ALLOWED$1;
		        }
		        // LB23 Do not break between digits and letters.
		        if ((ALPHABETICS.indexOf(next) !== -1 && current === NU) || (ALPHABETICS.indexOf(current) !== -1 && next === NU)) {
		            return BREAK_NOT_ALLOWED$1;
		        }
		        // LB23a Do not break between numeric prefixes and ideographs, or between ideographs and numeric postfixes.
		        if ((current === PR && [ID, EB, EM].indexOf(next) !== -1) ||
		            ([ID, EB, EM].indexOf(current) !== -1 && next === PO)) {
		            return BREAK_NOT_ALLOWED$1;
		        }
		        // LB24 Do not break between numeric prefix/postfix and letters, or between letters and prefix/postfix.
		        if ((ALPHABETICS.indexOf(current) !== -1 && PREFIX_POSTFIX.indexOf(next) !== -1) ||
		            (PREFIX_POSTFIX.indexOf(current) !== -1 && ALPHABETICS.indexOf(next) !== -1)) {
		            return BREAK_NOT_ALLOWED$1;
		        }
		        // LB25 Do not break between the following pairs of classes relevant to numbers:
		        if (
		        // (PR | PO) × ( OP | HY )? NU
		        ([PR, PO].indexOf(current) !== -1 &&
		            (next === NU || ([OP, HY].indexOf(next) !== -1 && classTypes[afterIndex + 1] === NU))) ||
		            // ( OP | HY ) × NU
		            ([OP, HY].indexOf(current) !== -1 && next === NU) ||
		            // NU ×	(NU | SY | IS)
		            (current === NU && [NU, SY, IS].indexOf(next) !== -1)) {
		            return BREAK_NOT_ALLOWED$1;
		        }
		        // NU (NU | SY | IS)* × (NU | SY | IS | CL | CP)
		        if ([NU, SY, IS, CL, CP].indexOf(next) !== -1) {
		            var prevIndex = currentIndex;
		            while (prevIndex >= 0) {
		                var type = classTypes[prevIndex];
		                if (type === NU) {
		                    return BREAK_NOT_ALLOWED$1;
		                }
		                else if ([SY, IS].indexOf(type) !== -1) {
		                    prevIndex--;
		                }
		                else {
		                    break;
		                }
		            }
		        }
		        // NU (NU | SY | IS)* (CL | CP)? × (PO | PR))
		        if ([PR, PO].indexOf(next) !== -1) {
		            var prevIndex = [CL, CP].indexOf(current) !== -1 ? beforeIndex : currentIndex;
		            while (prevIndex >= 0) {
		                var type = classTypes[prevIndex];
		                if (type === NU) {
		                    return BREAK_NOT_ALLOWED$1;
		                }
		                else if ([SY, IS].indexOf(type) !== -1) {
		                    prevIndex--;
		                }
		                else {
		                    break;
		                }
		            }
		        }
		        // LB26 Do not break a Korean syllable.
		        if ((JL === current && [JL, JV, H2, H3].indexOf(next) !== -1) ||
		            ([JV, H2].indexOf(current) !== -1 && [JV, JT].indexOf(next) !== -1) ||
		            ([JT, H3].indexOf(current) !== -1 && next === JT)) {
		            return BREAK_NOT_ALLOWED$1;
		        }
		        // LB27 Treat a Korean Syllable Block the same as ID.
		        if ((KOREAN_SYLLABLE_BLOCK.indexOf(current) !== -1 && [IN, PO].indexOf(next) !== -1) ||
		            (KOREAN_SYLLABLE_BLOCK.indexOf(next) !== -1 && current === PR)) {
		            return BREAK_NOT_ALLOWED$1;
		        }
		        // LB28 Do not break between alphabetics (“at”).
		        if (ALPHABETICS.indexOf(current) !== -1 && ALPHABETICS.indexOf(next) !== -1) {
		            return BREAK_NOT_ALLOWED$1;
		        }
		        // LB29 Do not break between numeric punctuation and alphabetics (“e.g.”).
		        if (current === IS && ALPHABETICS.indexOf(next) !== -1) {
		            return BREAK_NOT_ALLOWED$1;
		        }
		        // LB30 Do not break between letters, numbers, or ordinary symbols and opening or closing parentheses.
		        if ((ALPHABETICS.concat(NU).indexOf(current) !== -1 &&
		            next === OP &&
		            ea_OP.indexOf(codePoints[afterIndex]) === -1) ||
		            (ALPHABETICS.concat(NU).indexOf(next) !== -1 && current === CP)) {
		            return BREAK_NOT_ALLOWED$1;
		        }
		        // LB30a Break between two regional indicator symbols if and only if there are an even number of regional
		        // indicators preceding the position of the break.
		        if (current === RI$1 && next === RI$1) {
		            var i = indicies[currentIndex];
		            var count = 1;
		            while (i > 0) {
		                i--;
		                if (classTypes[i] === RI$1) {
		                    count++;
		                }
		                else {
		                    break;
		                }
		            }
		            if (count % 2 !== 0) {
		                return BREAK_NOT_ALLOWED$1;
		            }
		        }
		        // LB30b Do not break between an emoji base and an emoji modifier.
		        if (current === EB && next === EM) {
		            return BREAK_NOT_ALLOWED$1;
		        }
		        return BREAK_ALLOWED$1;
		    };
		    var cssFormattedClasses = function (codePoints, options) {
		        if (!options) {
		            options = { lineBreak: 'normal', wordBreak: 'normal' };
		        }
		        var _a = codePointsToCharacterClasses(codePoints, options.lineBreak), indicies = _a[0], classTypes = _a[1], isLetterNumber = _a[2];
		        if (options.wordBreak === 'break-all' || options.wordBreak === 'break-word') {
		            classTypes = classTypes.map(function (type) { return ([NU, AL, SA].indexOf(type) !== -1 ? ID : type); });
		        }
		        var forbiddenBreakpoints = options.wordBreak === 'keep-all'
		            ? isLetterNumber.map(function (letterNumber, i) {
		                return letterNumber && codePoints[i] >= 0x4e00 && codePoints[i] <= 0x9fff;
		            })
		            : undefined;
		        return [indicies, classTypes, forbiddenBreakpoints];
		    };
		    var Break = /** @class */ (function () {
		        function Break(codePoints, lineBreak, start, end) {
		            this.codePoints = codePoints;
		            this.required = lineBreak === BREAK_MANDATORY;
		            this.start = start;
		            this.end = end;
		        }
		        Break.prototype.slice = function () {
		            return fromCodePoint$1.apply(void 0, this.codePoints.slice(this.start, this.end));
		        };
		        return Break;
		    }());
		    var LineBreaker = function (str, options) {
		        var codePoints = toCodePoints$1(str);
		        var _a = cssFormattedClasses(codePoints, options), indicies = _a[0], classTypes = _a[1], forbiddenBreakpoints = _a[2];
		        var length = codePoints.length;
		        var lastEnd = 0;
		        var nextIndex = 0;
		        return {
		            next: function () {
		                if (nextIndex >= length) {
		                    return { done: true, value: null };
		                }
		                var lineBreak = BREAK_NOT_ALLOWED$1;
		                while (nextIndex < length &&
		                    (lineBreak = _lineBreakAtIndex(codePoints, classTypes, indicies, ++nextIndex, forbiddenBreakpoints)) ===
		                        BREAK_NOT_ALLOWED$1) { }
		                if (lineBreak !== BREAK_NOT_ALLOWED$1 || nextIndex === length) {
		                    var value = new Break(codePoints, lineBreak, lastEnd, nextIndex);
		                    lastEnd = nextIndex;
		                    return { value: value, done: false };
		                }
		                return { done: true, value: null };
		            },
		        };
		    };

		    // https://www.w3.org/TR/css-syntax-3
		    var FLAG_UNRESTRICTED = 1 << 0;
		    var FLAG_ID = 1 << 1;
		    var FLAG_INTEGER = 1 << 2;
		    var FLAG_NUMBER = 1 << 3;
		    var LINE_FEED = 0x000a;
		    var SOLIDUS = 0x002f;
		    var REVERSE_SOLIDUS = 0x005c;
		    var CHARACTER_TABULATION = 0x0009;
		    var SPACE = 0x0020;
		    var QUOTATION_MARK = 0x0022;
		    var EQUALS_SIGN = 0x003d;
		    var NUMBER_SIGN = 0x0023;
		    var DOLLAR_SIGN = 0x0024;
		    var PERCENTAGE_SIGN = 0x0025;
		    var APOSTROPHE = 0x0027;
		    var LEFT_PARENTHESIS = 0x0028;
		    var RIGHT_PARENTHESIS = 0x0029;
		    var LOW_LINE = 0x005f;
		    var HYPHEN_MINUS = 0x002d;
		    var EXCLAMATION_MARK = 0x0021;
		    var LESS_THAN_SIGN = 0x003c;
		    var GREATER_THAN_SIGN = 0x003e;
		    var COMMERCIAL_AT = 0x0040;
		    var LEFT_SQUARE_BRACKET = 0x005b;
		    var RIGHT_SQUARE_BRACKET = 0x005d;
		    var CIRCUMFLEX_ACCENT = 0x003d;
		    var LEFT_CURLY_BRACKET = 0x007b;
		    var QUESTION_MARK = 0x003f;
		    var RIGHT_CURLY_BRACKET = 0x007d;
		    var VERTICAL_LINE = 0x007c;
		    var TILDE = 0x007e;
		    var CONTROL = 0x0080;
		    var REPLACEMENT_CHARACTER = 0xfffd;
		    var ASTERISK = 0x002a;
		    var PLUS_SIGN = 0x002b;
		    var COMMA = 0x002c;
		    var COLON = 0x003a;
		    var SEMICOLON = 0x003b;
		    var FULL_STOP = 0x002e;
		    var NULL = 0x0000;
		    var BACKSPACE = 0x0008;
		    var LINE_TABULATION = 0x000b;
		    var SHIFT_OUT = 0x000e;
		    var INFORMATION_SEPARATOR_ONE = 0x001f;
		    var DELETE = 0x007f;
		    var EOF = -1;
		    var ZERO = 0x0030;
		    var a = 0x0061;
		    var e = 0x0065;
		    var f = 0x0066;
		    var u = 0x0075;
		    var z = 0x007a;
		    var A = 0x0041;
		    var E = 0x0045;
		    var F = 0x0046;
		    var U = 0x0055;
		    var Z = 0x005a;
		    var isDigit = function (codePoint) { return codePoint >= ZERO && codePoint <= 0x0039; };
		    var isSurrogateCodePoint = function (codePoint) { return codePoint >= 0xd800 && codePoint <= 0xdfff; };
		    var isHex = function (codePoint) {
		        return isDigit(codePoint) || (codePoint >= A && codePoint <= F) || (codePoint >= a && codePoint <= f);
		    };
		    var isLowerCaseLetter = function (codePoint) { return codePoint >= a && codePoint <= z; };
		    var isUpperCaseLetter = function (codePoint) { return codePoint >= A && codePoint <= Z; };
		    var isLetter = function (codePoint) { return isLowerCaseLetter(codePoint) || isUpperCaseLetter(codePoint); };
		    var isNonASCIICodePoint = function (codePoint) { return codePoint >= CONTROL; };
		    var isWhiteSpace = function (codePoint) {
		        return codePoint === LINE_FEED || codePoint === CHARACTER_TABULATION || codePoint === SPACE;
		    };
		    var isNameStartCodePoint = function (codePoint) {
		        return isLetter(codePoint) || isNonASCIICodePoint(codePoint) || codePoint === LOW_LINE;
		    };
		    var isNameCodePoint = function (codePoint) {
		        return isNameStartCodePoint(codePoint) || isDigit(codePoint) || codePoint === HYPHEN_MINUS;
		    };
		    var isNonPrintableCodePoint = function (codePoint) {
		        return ((codePoint >= NULL && codePoint <= BACKSPACE) ||
		            codePoint === LINE_TABULATION ||
		            (codePoint >= SHIFT_OUT && codePoint <= INFORMATION_SEPARATOR_ONE) ||
		            codePoint === DELETE);
		    };
		    var isValidEscape = function (c1, c2) {
		        if (c1 !== REVERSE_SOLIDUS) {
		            return false;
		        }
		        return c2 !== LINE_FEED;
		    };
		    var isIdentifierStart = function (c1, c2, c3) {
		        if (c1 === HYPHEN_MINUS) {
		            return isNameStartCodePoint(c2) || isValidEscape(c2, c3);
		        }
		        else if (isNameStartCodePoint(c1)) {
		            return true;
		        }
		        else if (c1 === REVERSE_SOLIDUS && isValidEscape(c1, c2)) {
		            return true;
		        }
		        return false;
		    };
		    var isNumberStart = function (c1, c2, c3) {
		        if (c1 === PLUS_SIGN || c1 === HYPHEN_MINUS) {
		            if (isDigit(c2)) {
		                return true;
		            }
		            return c2 === FULL_STOP && isDigit(c3);
		        }
		        if (c1 === FULL_STOP) {
		            return isDigit(c2);
		        }
		        return isDigit(c1);
		    };
		    var stringToNumber = function (codePoints) {
		        var c = 0;
		        var sign = 1;
		        if (codePoints[c] === PLUS_SIGN || codePoints[c] === HYPHEN_MINUS) {
		            if (codePoints[c] === HYPHEN_MINUS) {
		                sign = -1;
		            }
		            c++;
		        }
		        var integers = [];
		        while (isDigit(codePoints[c])) {
		            integers.push(codePoints[c++]);
		        }
		        var int = integers.length ? parseInt(fromCodePoint$1.apply(void 0, integers), 10) : 0;
		        if (codePoints[c] === FULL_STOP) {
		            c++;
		        }
		        var fraction = [];
		        while (isDigit(codePoints[c])) {
		            fraction.push(codePoints[c++]);
		        }
		        var fracd = fraction.length;
		        var frac = fracd ? parseInt(fromCodePoint$1.apply(void 0, fraction), 10) : 0;
		        if (codePoints[c] === E || codePoints[c] === e) {
		            c++;
		        }
		        var expsign = 1;
		        if (codePoints[c] === PLUS_SIGN || codePoints[c] === HYPHEN_MINUS) {
		            if (codePoints[c] === HYPHEN_MINUS) {
		                expsign = -1;
		            }
		            c++;
		        }
		        var exponent = [];
		        while (isDigit(codePoints[c])) {
		            exponent.push(codePoints[c++]);
		        }
		        var exp = exponent.length ? parseInt(fromCodePoint$1.apply(void 0, exponent), 10) : 0;
		        return sign * (int + frac * Math.pow(10, -fracd)) * Math.pow(10, expsign * exp);
		    };
		    var LEFT_PARENTHESIS_TOKEN = {
		        type: 2 /* LEFT_PARENTHESIS_TOKEN */
		    };
		    var RIGHT_PARENTHESIS_TOKEN = {
		        type: 3 /* RIGHT_PARENTHESIS_TOKEN */
		    };
		    var COMMA_TOKEN = { type: 4 /* COMMA_TOKEN */ };
		    var SUFFIX_MATCH_TOKEN = { type: 13 /* SUFFIX_MATCH_TOKEN */ };
		    var PREFIX_MATCH_TOKEN = { type: 8 /* PREFIX_MATCH_TOKEN */ };
		    var COLUMN_TOKEN = { type: 21 /* COLUMN_TOKEN */ };
		    var DASH_MATCH_TOKEN = { type: 9 /* DASH_MATCH_TOKEN */ };
		    var INCLUDE_MATCH_TOKEN = { type: 10 /* INCLUDE_MATCH_TOKEN */ };
		    var LEFT_CURLY_BRACKET_TOKEN = {
		        type: 11 /* LEFT_CURLY_BRACKET_TOKEN */
		    };
		    var RIGHT_CURLY_BRACKET_TOKEN = {
		        type: 12 /* RIGHT_CURLY_BRACKET_TOKEN */
		    };
		    var SUBSTRING_MATCH_TOKEN = { type: 14 /* SUBSTRING_MATCH_TOKEN */ };
		    var BAD_URL_TOKEN = { type: 23 /* BAD_URL_TOKEN */ };
		    var BAD_STRING_TOKEN = { type: 1 /* BAD_STRING_TOKEN */ };
		    var CDO_TOKEN = { type: 25 /* CDO_TOKEN */ };
		    var CDC_TOKEN = { type: 24 /* CDC_TOKEN */ };
		    var COLON_TOKEN = { type: 26 /* COLON_TOKEN */ };
		    var SEMICOLON_TOKEN = { type: 27 /* SEMICOLON_TOKEN */ };
		    var LEFT_SQUARE_BRACKET_TOKEN = {
		        type: 28 /* LEFT_SQUARE_BRACKET_TOKEN */
		    };
		    var RIGHT_SQUARE_BRACKET_TOKEN = {
		        type: 29 /* RIGHT_SQUARE_BRACKET_TOKEN */
		    };
		    var WHITESPACE_TOKEN = { type: 31 /* WHITESPACE_TOKEN */ };
		    var EOF_TOKEN = { type: 32 /* EOF_TOKEN */ };
		    var Tokenizer = /** @class */ (function () {
		        function Tokenizer() {
		            this._value = [];
		        }
		        Tokenizer.prototype.write = function (chunk) {
		            this._value = this._value.concat(toCodePoints$1(chunk));
		        };
		        Tokenizer.prototype.read = function () {
		            var tokens = [];
		            var token = this.consumeToken();
		            while (token !== EOF_TOKEN) {
		                tokens.push(token);
		                token = this.consumeToken();
		            }
		            return tokens;
		        };
		        Tokenizer.prototype.consumeToken = function () {
		            var codePoint = this.consumeCodePoint();
		            switch (codePoint) {
		                case QUOTATION_MARK:
		                    return this.consumeStringToken(QUOTATION_MARK);
		                case NUMBER_SIGN:
		                    var c1 = this.peekCodePoint(0);
		                    var c2 = this.peekCodePoint(1);
		                    var c3 = this.peekCodePoint(2);
		                    if (isNameCodePoint(c1) || isValidEscape(c2, c3)) {
		                        var flags = isIdentifierStart(c1, c2, c3) ? FLAG_ID : FLAG_UNRESTRICTED;
		                        var value = this.consumeName();
		                        return { type: 5 /* HASH_TOKEN */, value: value, flags: flags };
		                    }
		                    break;
		                case DOLLAR_SIGN:
		                    if (this.peekCodePoint(0) === EQUALS_SIGN) {
		                        this.consumeCodePoint();
		                        return SUFFIX_MATCH_TOKEN;
		                    }
		                    break;
		                case APOSTROPHE:
		                    return this.consumeStringToken(APOSTROPHE);
		                case LEFT_PARENTHESIS:
		                    return LEFT_PARENTHESIS_TOKEN;
		                case RIGHT_PARENTHESIS:
		                    return RIGHT_PARENTHESIS_TOKEN;
		                case ASTERISK:
		                    if (this.peekCodePoint(0) === EQUALS_SIGN) {
		                        this.consumeCodePoint();
		                        return SUBSTRING_MATCH_TOKEN;
		                    }
		                    break;
		                case PLUS_SIGN:
		                    if (isNumberStart(codePoint, this.peekCodePoint(0), this.peekCodePoint(1))) {
		                        this.reconsumeCodePoint(codePoint);
		                        return this.consumeNumericToken();
		                    }
		                    break;
		                case COMMA:
		                    return COMMA_TOKEN;
		                case HYPHEN_MINUS:
		                    var e1 = codePoint;
		                    var e2 = this.peekCodePoint(0);
		                    var e3 = this.peekCodePoint(1);
		                    if (isNumberStart(e1, e2, e3)) {
		                        this.reconsumeCodePoint(codePoint);
		                        return this.consumeNumericToken();
		                    }
		                    if (isIdentifierStart(e1, e2, e3)) {
		                        this.reconsumeCodePoint(codePoint);
		                        return this.consumeIdentLikeToken();
		                    }
		                    if (e2 === HYPHEN_MINUS && e3 === GREATER_THAN_SIGN) {
		                        this.consumeCodePoint();
		                        this.consumeCodePoint();
		                        return CDC_TOKEN;
		                    }
		                    break;
		                case FULL_STOP:
		                    if (isNumberStart(codePoint, this.peekCodePoint(0), this.peekCodePoint(1))) {
		                        this.reconsumeCodePoint(codePoint);
		                        return this.consumeNumericToken();
		                    }
		                    break;
		                case SOLIDUS:
		                    if (this.peekCodePoint(0) === ASTERISK) {
		                        this.consumeCodePoint();
		                        while (true) {
		                            var c = this.consumeCodePoint();
		                            if (c === ASTERISK) {
		                                c = this.consumeCodePoint();
		                                if (c === SOLIDUS) {
		                                    return this.consumeToken();
		                                }
		                            }
		                            if (c === EOF) {
		                                return this.consumeToken();
		                            }
		                        }
		                    }
		                    break;
		                case COLON:
		                    return COLON_TOKEN;
		                case SEMICOLON:
		                    return SEMICOLON_TOKEN;
		                case LESS_THAN_SIGN:
		                    if (this.peekCodePoint(0) === EXCLAMATION_MARK &&
		                        this.peekCodePoint(1) === HYPHEN_MINUS &&
		                        this.peekCodePoint(2) === HYPHEN_MINUS) {
		                        this.consumeCodePoint();
		                        this.consumeCodePoint();
		                        return CDO_TOKEN;
		                    }
		                    break;
		                case COMMERCIAL_AT:
		                    var a1 = this.peekCodePoint(0);
		                    var a2 = this.peekCodePoint(1);
		                    var a3 = this.peekCodePoint(2);
		                    if (isIdentifierStart(a1, a2, a3)) {
		                        var value = this.consumeName();
		                        return { type: 7 /* AT_KEYWORD_TOKEN */, value: value };
		                    }
		                    break;
		                case LEFT_SQUARE_BRACKET:
		                    return LEFT_SQUARE_BRACKET_TOKEN;
		                case REVERSE_SOLIDUS:
		                    if (isValidEscape(codePoint, this.peekCodePoint(0))) {
		                        this.reconsumeCodePoint(codePoint);
		                        return this.consumeIdentLikeToken();
		                    }
		                    break;
		                case RIGHT_SQUARE_BRACKET:
		                    return RIGHT_SQUARE_BRACKET_TOKEN;
		                case CIRCUMFLEX_ACCENT:
		                    if (this.peekCodePoint(0) === EQUALS_SIGN) {
		                        this.consumeCodePoint();
		                        return PREFIX_MATCH_TOKEN;
		                    }
		                    break;
		                case LEFT_CURLY_BRACKET:
		                    return LEFT_CURLY_BRACKET_TOKEN;
		                case RIGHT_CURLY_BRACKET:
		                    return RIGHT_CURLY_BRACKET_TOKEN;
		                case u:
		                case U:
		                    var u1 = this.peekCodePoint(0);
		                    var u2 = this.peekCodePoint(1);
		                    if (u1 === PLUS_SIGN && (isHex(u2) || u2 === QUESTION_MARK)) {
		                        this.consumeCodePoint();
		                        this.consumeUnicodeRangeToken();
		                    }
		                    this.reconsumeCodePoint(codePoint);
		                    return this.consumeIdentLikeToken();
		                case VERTICAL_LINE:
		                    if (this.peekCodePoint(0) === EQUALS_SIGN) {
		                        this.consumeCodePoint();
		                        return DASH_MATCH_TOKEN;
		                    }
		                    if (this.peekCodePoint(0) === VERTICAL_LINE) {
		                        this.consumeCodePoint();
		                        return COLUMN_TOKEN;
		                    }
		                    break;
		                case TILDE:
		                    if (this.peekCodePoint(0) === EQUALS_SIGN) {
		                        this.consumeCodePoint();
		                        return INCLUDE_MATCH_TOKEN;
		                    }
		                    break;
		                case EOF:
		                    return EOF_TOKEN;
		            }
		            if (isWhiteSpace(codePoint)) {
		                this.consumeWhiteSpace();
		                return WHITESPACE_TOKEN;
		            }
		            if (isDigit(codePoint)) {
		                this.reconsumeCodePoint(codePoint);
		                return this.consumeNumericToken();
		            }
		            if (isNameStartCodePoint(codePoint)) {
		                this.reconsumeCodePoint(codePoint);
		                return this.consumeIdentLikeToken();
		            }
		            return { type: 6 /* DELIM_TOKEN */, value: fromCodePoint$1(codePoint) };
		        };
		        Tokenizer.prototype.consumeCodePoint = function () {
		            var value = this._value.shift();
		            return typeof value === 'undefined' ? -1 : value;
		        };
		        Tokenizer.prototype.reconsumeCodePoint = function (codePoint) {
		            this._value.unshift(codePoint);
		        };
		        Tokenizer.prototype.peekCodePoint = function (delta) {
		            if (delta >= this._value.length) {
		                return -1;
		            }
		            return this._value[delta];
		        };
		        Tokenizer.prototype.consumeUnicodeRangeToken = function () {
		            var digits = [];
		            var codePoint = this.consumeCodePoint();
		            while (isHex(codePoint) && digits.length < 6) {
		                digits.push(codePoint);
		                codePoint = this.consumeCodePoint();
		            }
		            var questionMarks = false;
		            while (codePoint === QUESTION_MARK && digits.length < 6) {
		                digits.push(codePoint);
		                codePoint = this.consumeCodePoint();
		                questionMarks = true;
		            }
		            if (questionMarks) {
		                var start_1 = parseInt(fromCodePoint$1.apply(void 0, digits.map(function (digit) { return (digit === QUESTION_MARK ? ZERO : digit); })), 16);
		                var end = parseInt(fromCodePoint$1.apply(void 0, digits.map(function (digit) { return (digit === QUESTION_MARK ? F : digit); })), 16);
		                return { type: 30 /* UNICODE_RANGE_TOKEN */, start: start_1, end: end };
		            }
		            var start = parseInt(fromCodePoint$1.apply(void 0, digits), 16);
		            if (this.peekCodePoint(0) === HYPHEN_MINUS && isHex(this.peekCodePoint(1))) {
		                this.consumeCodePoint();
		                codePoint = this.consumeCodePoint();
		                var endDigits = [];
		                while (isHex(codePoint) && endDigits.length < 6) {
		                    endDigits.push(codePoint);
		                    codePoint = this.consumeCodePoint();
		                }
		                var end = parseInt(fromCodePoint$1.apply(void 0, endDigits), 16);
		                return { type: 30 /* UNICODE_RANGE_TOKEN */, start: start, end: end };
		            }
		            else {
		                return { type: 30 /* UNICODE_RANGE_TOKEN */, start: start, end: start };
		            }
		        };
		        Tokenizer.prototype.consumeIdentLikeToken = function () {
		            var value = this.consumeName();
		            if (value.toLowerCase() === 'url' && this.peekCodePoint(0) === LEFT_PARENTHESIS) {
		                this.consumeCodePoint();
		                return this.consumeUrlToken();
		            }
		            else if (this.peekCodePoint(0) === LEFT_PARENTHESIS) {
		                this.consumeCodePoint();
		                return { type: 19 /* FUNCTION_TOKEN */, value: value };
		            }
		            return { type: 20 /* IDENT_TOKEN */, value: value };
		        };
		        Tokenizer.prototype.consumeUrlToken = function () {
		            var value = [];
		            this.consumeWhiteSpace();
		            if (this.peekCodePoint(0) === EOF) {
		                return { type: 22 /* URL_TOKEN */, value: '' };
		            }
		            var next = this.peekCodePoint(0);
		            if (next === APOSTROPHE || next === QUOTATION_MARK) {
		                var stringToken = this.consumeStringToken(this.consumeCodePoint());
		                if (stringToken.type === 0 /* STRING_TOKEN */) {
		                    this.consumeWhiteSpace();
		                    if (this.peekCodePoint(0) === EOF || this.peekCodePoint(0) === RIGHT_PARENTHESIS) {
		                        this.consumeCodePoint();
		                        return { type: 22 /* URL_TOKEN */, value: stringToken.value };
		                    }
		                }
		                this.consumeBadUrlRemnants();
		                return BAD_URL_TOKEN;
		            }
		            while (true) {
		                var codePoint = this.consumeCodePoint();
		                if (codePoint === EOF || codePoint === RIGHT_PARENTHESIS) {
		                    return { type: 22 /* URL_TOKEN */, value: fromCodePoint$1.apply(void 0, value) };
		                }
		                else if (isWhiteSpace(codePoint)) {
		                    this.consumeWhiteSpace();
		                    if (this.peekCodePoint(0) === EOF || this.peekCodePoint(0) === RIGHT_PARENTHESIS) {
		                        this.consumeCodePoint();
		                        return { type: 22 /* URL_TOKEN */, value: fromCodePoint$1.apply(void 0, value) };
		                    }
		                    this.consumeBadUrlRemnants();
		                    return BAD_URL_TOKEN;
		                }
		                else if (codePoint === QUOTATION_MARK ||
		                    codePoint === APOSTROPHE ||
		                    codePoint === LEFT_PARENTHESIS ||
		                    isNonPrintableCodePoint(codePoint)) {
		                    this.consumeBadUrlRemnants();
		                    return BAD_URL_TOKEN;
		                }
		                else if (codePoint === REVERSE_SOLIDUS) {
		                    if (isValidEscape(codePoint, this.peekCodePoint(0))) {
		                        value.push(this.consumeEscapedCodePoint());
		                    }
		                    else {
		                        this.consumeBadUrlRemnants();
		                        return BAD_URL_TOKEN;
		                    }
		                }
		                else {
		                    value.push(codePoint);
		                }
		            }
		        };
		        Tokenizer.prototype.consumeWhiteSpace = function () {
		            while (isWhiteSpace(this.peekCodePoint(0))) {
		                this.consumeCodePoint();
		            }
		        };
		        Tokenizer.prototype.consumeBadUrlRemnants = function () {
		            while (true) {
		                var codePoint = this.consumeCodePoint();
		                if (codePoint === RIGHT_PARENTHESIS || codePoint === EOF) {
		                    return;
		                }
		                if (isValidEscape(codePoint, this.peekCodePoint(0))) {
		                    this.consumeEscapedCodePoint();
		                }
		            }
		        };
		        Tokenizer.prototype.consumeStringSlice = function (count) {
		            var SLICE_STACK_SIZE = 50000;
		            var value = '';
		            while (count > 0) {
		                var amount = Math.min(SLICE_STACK_SIZE, count);
		                value += fromCodePoint$1.apply(void 0, this._value.splice(0, amount));
		                count -= amount;
		            }
		            this._value.shift();
		            return value;
		        };
		        Tokenizer.prototype.consumeStringToken = function (endingCodePoint) {
		            var value = '';
		            var i = 0;
		            do {
		                var codePoint = this._value[i];
		                if (codePoint === EOF || codePoint === undefined || codePoint === endingCodePoint) {
		                    value += this.consumeStringSlice(i);
		                    return { type: 0 /* STRING_TOKEN */, value: value };
		                }
		                if (codePoint === LINE_FEED) {
		                    this._value.splice(0, i);
		                    return BAD_STRING_TOKEN;
		                }
		                if (codePoint === REVERSE_SOLIDUS) {
		                    var next = this._value[i + 1];
		                    if (next !== EOF && next !== undefined) {
		                        if (next === LINE_FEED) {
		                            value += this.consumeStringSlice(i);
		                            i = -1;
		                            this._value.shift();
		                        }
		                        else if (isValidEscape(codePoint, next)) {
		                            value += this.consumeStringSlice(i);
		                            value += fromCodePoint$1(this.consumeEscapedCodePoint());
		                            i = -1;
		                        }
		                    }
		                }
		                i++;
		            } while (true);
		        };
		        Tokenizer.prototype.consumeNumber = function () {
		            var repr = [];
		            var type = FLAG_INTEGER;
		            var c1 = this.peekCodePoint(0);
		            if (c1 === PLUS_SIGN || c1 === HYPHEN_MINUS) {
		                repr.push(this.consumeCodePoint());
		            }
		            while (isDigit(this.peekCodePoint(0))) {
		                repr.push(this.consumeCodePoint());
		            }
		            c1 = this.peekCodePoint(0);
		            var c2 = this.peekCodePoint(1);
		            if (c1 === FULL_STOP && isDigit(c2)) {
		                repr.push(this.consumeCodePoint(), this.consumeCodePoint());
		                type = FLAG_NUMBER;
		                while (isDigit(this.peekCodePoint(0))) {
		                    repr.push(this.consumeCodePoint());
		                }
		            }
		            c1 = this.peekCodePoint(0);
		            c2 = this.peekCodePoint(1);
		            var c3 = this.peekCodePoint(2);
		            if ((c1 === E || c1 === e) && (((c2 === PLUS_SIGN || c2 === HYPHEN_MINUS) && isDigit(c3)) || isDigit(c2))) {
		                repr.push(this.consumeCodePoint(), this.consumeCodePoint());
		                type = FLAG_NUMBER;
		                while (isDigit(this.peekCodePoint(0))) {
		                    repr.push(this.consumeCodePoint());
		                }
		            }
		            return [stringToNumber(repr), type];
		        };
		        Tokenizer.prototype.consumeNumericToken = function () {
		            var _a = this.consumeNumber(), number = _a[0], flags = _a[1];
		            var c1 = this.peekCodePoint(0);
		            var c2 = this.peekCodePoint(1);
		            var c3 = this.peekCodePoint(2);
		            if (isIdentifierStart(c1, c2, c3)) {
		                var unit = this.consumeName();
		                return { type: 15 /* DIMENSION_TOKEN */, number: number, flags: flags, unit: unit };
		            }
		            if (c1 === PERCENTAGE_SIGN) {
		                this.consumeCodePoint();
		                return { type: 16 /* PERCENTAGE_TOKEN */, number: number, flags: flags };
		            }
		            return { type: 17 /* NUMBER_TOKEN */, number: number, flags: flags };
		        };
		        Tokenizer.prototype.consumeEscapedCodePoint = function () {
		            var codePoint = this.consumeCodePoint();
		            if (isHex(codePoint)) {
		                var hex = fromCodePoint$1(codePoint);
		                while (isHex(this.peekCodePoint(0)) && hex.length < 6) {
		                    hex += fromCodePoint$1(this.consumeCodePoint());
		                }
		                if (isWhiteSpace(this.peekCodePoint(0))) {
		                    this.consumeCodePoint();
		                }
		                var hexCodePoint = parseInt(hex, 16);
		                if (hexCodePoint === 0 || isSurrogateCodePoint(hexCodePoint) || hexCodePoint > 0x10ffff) {
		                    return REPLACEMENT_CHARACTER;
		                }
		                return hexCodePoint;
		            }
		            if (codePoint === EOF) {
		                return REPLACEMENT_CHARACTER;
		            }
		            return codePoint;
		        };
		        Tokenizer.prototype.consumeName = function () {
		            var result = '';
		            while (true) {
		                var codePoint = this.consumeCodePoint();
		                if (isNameCodePoint(codePoint)) {
		                    result += fromCodePoint$1(codePoint);
		                }
		                else if (isValidEscape(codePoint, this.peekCodePoint(0))) {
		                    result += fromCodePoint$1(this.consumeEscapedCodePoint());
		                }
		                else {
		                    this.reconsumeCodePoint(codePoint);
		                    return result;
		                }
		            }
		        };
		        return Tokenizer;
		    }());

		    var Parser = /** @class */ (function () {
		        function Parser(tokens) {
		            this._tokens = tokens;
		        }
		        Parser.create = function (value) {
		            var tokenizer = new Tokenizer();
		            tokenizer.write(value);
		            return new Parser(tokenizer.read());
		        };
		        Parser.parseValue = function (value) {
		            return Parser.create(value).parseComponentValue();
		        };
		        Parser.parseValues = function (value) {
		            return Parser.create(value).parseComponentValues();
		        };
		        Parser.prototype.parseComponentValue = function () {
		            var token = this.consumeToken();
		            while (token.type === 31 /* WHITESPACE_TOKEN */) {
		                token = this.consumeToken();
		            }
		            if (token.type === 32 /* EOF_TOKEN */) {
		                throw new SyntaxError("Error parsing CSS component value, unexpected EOF");
		            }
		            this.reconsumeToken(token);
		            var value = this.consumeComponentValue();
		            do {
		                token = this.consumeToken();
		            } while (token.type === 31 /* WHITESPACE_TOKEN */);
		            if (token.type === 32 /* EOF_TOKEN */) {
		                return value;
		            }
		            throw new SyntaxError("Error parsing CSS component value, multiple values found when expecting only one");
		        };
		        Parser.prototype.parseComponentValues = function () {
		            var values = [];
		            while (true) {
		                var value = this.consumeComponentValue();
		                if (value.type === 32 /* EOF_TOKEN */) {
		                    return values;
		                }
		                values.push(value);
		                values.push();
		            }
		        };
		        Parser.prototype.consumeComponentValue = function () {
		            var token = this.consumeToken();
		            switch (token.type) {
		                case 11 /* LEFT_CURLY_BRACKET_TOKEN */:
		                case 28 /* LEFT_SQUARE_BRACKET_TOKEN */:
		                case 2 /* LEFT_PARENTHESIS_TOKEN */:
		                    return this.consumeSimpleBlock(token.type);
		                case 19 /* FUNCTION_TOKEN */:
		                    return this.consumeFunction(token);
		            }
		            return token;
		        };
		        Parser.prototype.consumeSimpleBlock = function (type) {
		            var block = { type: type, values: [] };
		            var token = this.consumeToken();
		            while (true) {
		                if (token.type === 32 /* EOF_TOKEN */ || isEndingTokenFor(token, type)) {
		                    return block;
		                }
		                this.reconsumeToken(token);
		                block.values.push(this.consumeComponentValue());
		                token = this.consumeToken();
		            }
		        };
		        Parser.prototype.consumeFunction = function (functionToken) {
		            var cssFunction = {
		                name: functionToken.value,
		                values: [],
		                type: 18 /* FUNCTION */
		            };
		            while (true) {
		                var token = this.consumeToken();
		                if (token.type === 32 /* EOF_TOKEN */ || token.type === 3 /* RIGHT_PARENTHESIS_TOKEN */) {
		                    return cssFunction;
		                }
		                this.reconsumeToken(token);
		                cssFunction.values.push(this.consumeComponentValue());
		            }
		        };
		        Parser.prototype.consumeToken = function () {
		            var token = this._tokens.shift();
		            return typeof token === 'undefined' ? EOF_TOKEN : token;
		        };
		        Parser.prototype.reconsumeToken = function (token) {
		            this._tokens.unshift(token);
		        };
		        return Parser;
		    }());
		    var isDimensionToken = function (token) { return token.type === 15 /* DIMENSION_TOKEN */; };
		    var isNumberToken = function (token) { return token.type === 17 /* NUMBER_TOKEN */; };
		    var isIdentToken = function (token) { return token.type === 20 /* IDENT_TOKEN */; };
		    var isStringToken = function (token) { return token.type === 0 /* STRING_TOKEN */; };
		    var isIdentWithValue = function (token, value) {
		        return isIdentToken(token) && token.value === value;
		    };
		    var nonWhiteSpace = function (token) { return token.type !== 31 /* WHITESPACE_TOKEN */; };
		    var nonFunctionArgSeparator = function (token) {
		        return token.type !== 31 /* WHITESPACE_TOKEN */ && token.type !== 4 /* COMMA_TOKEN */;
		    };
		    var parseFunctionArgs = function (tokens) {
		        var args = [];
		        var arg = [];
		        tokens.forEach(function (token) {
		            if (token.type === 4 /* COMMA_TOKEN */) {
		                if (arg.length === 0) {
		                    throw new Error("Error parsing function args, zero tokens for arg");
		                }
		                args.push(arg);
		                arg = [];
		                return;
		            }
		            if (token.type !== 31 /* WHITESPACE_TOKEN */) {
		                arg.push(token);
		            }
		        });
		        if (arg.length) {
		            args.push(arg);
		        }
		        return args;
		    };
		    var isEndingTokenFor = function (token, type) {
		        if (type === 11 /* LEFT_CURLY_BRACKET_TOKEN */ && token.type === 12 /* RIGHT_CURLY_BRACKET_TOKEN */) {
		            return true;
		        }
		        if (type === 28 /* LEFT_SQUARE_BRACKET_TOKEN */ && token.type === 29 /* RIGHT_SQUARE_BRACKET_TOKEN */) {
		            return true;
		        }
		        return type === 2 /* LEFT_PARENTHESIS_TOKEN */ && token.type === 3 /* RIGHT_PARENTHESIS_TOKEN */;
		    };

		    var isLength = function (token) {
		        return token.type === 17 /* NUMBER_TOKEN */ || token.type === 15 /* DIMENSION_TOKEN */;
		    };

		    var isLengthPercentage = function (token) {
		        return token.type === 16 /* PERCENTAGE_TOKEN */ || isLength(token);
		    };
		    var parseLengthPercentageTuple = function (tokens) {
		        return tokens.length > 1 ? [tokens[0], tokens[1]] : [tokens[0]];
		    };
		    var ZERO_LENGTH = {
		        type: 17 /* NUMBER_TOKEN */,
		        number: 0,
		        flags: FLAG_INTEGER
		    };
		    var FIFTY_PERCENT = {
		        type: 16 /* PERCENTAGE_TOKEN */,
		        number: 50,
		        flags: FLAG_INTEGER
		    };
		    var HUNDRED_PERCENT = {
		        type: 16 /* PERCENTAGE_TOKEN */,
		        number: 100,
		        flags: FLAG_INTEGER
		    };
		    var getAbsoluteValueForTuple = function (tuple, width, height) {
		        var x = tuple[0], y = tuple[1];
		        return [getAbsoluteValue(x, width), getAbsoluteValue(typeof y !== 'undefined' ? y : x, height)];
		    };
		    var getAbsoluteValue = function (token, parent) {
		        if (token.type === 16 /* PERCENTAGE_TOKEN */) {
		            return (token.number / 100) * parent;
		        }
		        if (isDimensionToken(token)) {
		            switch (token.unit) {
		                case 'rem':
		                case 'em':
		                    return 16 * token.number; // TODO use correct font-size
		                case 'px':
		                default:
		                    return token.number;
		            }
		        }
		        return token.number;
		    };

		    var DEG = 'deg';
		    var GRAD = 'grad';
		    var RAD = 'rad';
		    var TURN = 'turn';
		    var angle = {
		        name: 'angle',
		        parse: function (_context, value) {
		            if (value.type === 15 /* DIMENSION_TOKEN */) {
		                switch (value.unit) {
		                    case DEG:
		                        return (Math.PI * value.number) / 180;
		                    case GRAD:
		                        return (Math.PI / 200) * value.number;
		                    case RAD:
		                        return value.number;
		                    case TURN:
		                        return Math.PI * 2 * value.number;
		                }
		            }
		            throw new Error("Unsupported angle type");
		        }
		    };
		    var isAngle = function (value) {
		        if (value.type === 15 /* DIMENSION_TOKEN */) {
		            if (value.unit === DEG || value.unit === GRAD || value.unit === RAD || value.unit === TURN) {
		                return true;
		            }
		        }
		        return false;
		    };
		    var parseNamedSide = function (tokens) {
		        var sideOrCorner = tokens
		            .filter(isIdentToken)
		            .map(function (ident) { return ident.value; })
		            .join(' ');
		        switch (sideOrCorner) {
		            case 'to bottom right':
		            case 'to right bottom':
		            case 'left top':
		            case 'top left':
		                return [ZERO_LENGTH, ZERO_LENGTH];
		            case 'to top':
		            case 'bottom':
		                return deg(0);
		            case 'to bottom left':
		            case 'to left bottom':
		            case 'right top':
		            case 'top right':
		                return [ZERO_LENGTH, HUNDRED_PERCENT];
		            case 'to right':
		            case 'left':
		                return deg(90);
		            case 'to top left':
		            case 'to left top':
		            case 'right bottom':
		            case 'bottom right':
		                return [HUNDRED_PERCENT, HUNDRED_PERCENT];
		            case 'to bottom':
		            case 'top':
		                return deg(180);
		            case 'to top right':
		            case 'to right top':
		            case 'left bottom':
		            case 'bottom left':
		                return [HUNDRED_PERCENT, ZERO_LENGTH];
		            case 'to left':
		            case 'right':
		                return deg(270);
		        }
		        return 0;
		    };
		    var deg = function (deg) { return (Math.PI * deg) / 180; };

		    var color$1 = {
		        name: 'color',
		        parse: function (context, value) {
		            if (value.type === 18 /* FUNCTION */) {
		                var colorFunction = SUPPORTED_COLOR_FUNCTIONS[value.name];
		                if (typeof colorFunction === 'undefined') {
		                    throw new Error("Attempting to parse an unsupported color function \"" + value.name + "\"");
		                }
		                return colorFunction(context, value.values);
		            }
		            if (value.type === 5 /* HASH_TOKEN */) {
		                if (value.value.length === 3) {
		                    var r = value.value.substring(0, 1);
		                    var g = value.value.substring(1, 2);
		                    var b = value.value.substring(2, 3);
		                    return pack(parseInt(r + r, 16), parseInt(g + g, 16), parseInt(b + b, 16), 1);
		                }
		                if (value.value.length === 4) {
		                    var r = value.value.substring(0, 1);
		                    var g = value.value.substring(1, 2);
		                    var b = value.value.substring(2, 3);
		                    var a = value.value.substring(3, 4);
		                    return pack(parseInt(r + r, 16), parseInt(g + g, 16), parseInt(b + b, 16), parseInt(a + a, 16) / 255);
		                }
		                if (value.value.length === 6) {
		                    var r = value.value.substring(0, 2);
		                    var g = value.value.substring(2, 4);
		                    var b = value.value.substring(4, 6);
		                    return pack(parseInt(r, 16), parseInt(g, 16), parseInt(b, 16), 1);
		                }
		                if (value.value.length === 8) {
		                    var r = value.value.substring(0, 2);
		                    var g = value.value.substring(2, 4);
		                    var b = value.value.substring(4, 6);
		                    var a = value.value.substring(6, 8);
		                    return pack(parseInt(r, 16), parseInt(g, 16), parseInt(b, 16), parseInt(a, 16) / 255);
		                }
		            }
		            if (value.type === 20 /* IDENT_TOKEN */) {
		                var namedColor = COLORS[value.value.toUpperCase()];
		                if (typeof namedColor !== 'undefined') {
		                    return namedColor;
		                }
		            }
		            return COLORS.TRANSPARENT;
		        }
		    };
		    var isTransparent = function (color) { return (0xff & color) === 0; };
		    var asString = function (color) {
		        var alpha = 0xff & color;
		        var blue = 0xff & (color >> 8);
		        var green = 0xff & (color >> 16);
		        var red = 0xff & (color >> 24);
		        return alpha < 255 ? "rgba(" + red + "," + green + "," + blue + "," + alpha / 255 + ")" : "rgb(" + red + "," + green + "," + blue + ")";
		    };
		    var pack = function (r, g, b, a) {
		        return ((r << 24) | (g << 16) | (b << 8) | (Math.round(a * 255) << 0)) >>> 0;
		    };
		    var getTokenColorValue = function (token, i) {
		        if (token.type === 17 /* NUMBER_TOKEN */) {
		            return token.number;
		        }
		        if (token.type === 16 /* PERCENTAGE_TOKEN */) {
		            var max = i === 3 ? 1 : 255;
		            return i === 3 ? (token.number / 100) * max : Math.round((token.number / 100) * max);
		        }
		        return 0;
		    };
		    var rgb = function (_context, args) {
		        var tokens = args.filter(nonFunctionArgSeparator);
		        if (tokens.length === 3) {
		            var _a = tokens.map(getTokenColorValue), r = _a[0], g = _a[1], b = _a[2];
		            return pack(r, g, b, 1);
		        }
		        if (tokens.length === 4) {
		            var _b = tokens.map(getTokenColorValue), r = _b[0], g = _b[1], b = _b[2], a = _b[3];
		            return pack(r, g, b, a);
		        }
		        return 0;
		    };
		    function hue2rgb(t1, t2, hue) {
		        if (hue < 0) {
		            hue += 1;
		        }
		        if (hue >= 1) {
		            hue -= 1;
		        }
		        if (hue < 1 / 6) {
		            return (t2 - t1) * hue * 6 + t1;
		        }
		        else if (hue < 1 / 2) {
		            return t2;
		        }
		        else if (hue < 2 / 3) {
		            return (t2 - t1) * 6 * (2 / 3 - hue) + t1;
		        }
		        else {
		            return t1;
		        }
		    }
		    var hsl = function (context, args) {
		        var tokens = args.filter(nonFunctionArgSeparator);
		        var hue = tokens[0], saturation = tokens[1], lightness = tokens[2], alpha = tokens[3];
		        var h = (hue.type === 17 /* NUMBER_TOKEN */ ? deg(hue.number) : angle.parse(context, hue)) / (Math.PI * 2);
		        var s = isLengthPercentage(saturation) ? saturation.number / 100 : 0;
		        var l = isLengthPercentage(lightness) ? lightness.number / 100 : 0;
		        var a = typeof alpha !== 'undefined' && isLengthPercentage(alpha) ? getAbsoluteValue(alpha, 1) : 1;
		        if (s === 0) {
		            return pack(l * 255, l * 255, l * 255, 1);
		        }
		        var t2 = l <= 0.5 ? l * (s + 1) : l + s - l * s;
		        var t1 = l * 2 - t2;
		        var r = hue2rgb(t1, t2, h + 1 / 3);
		        var g = hue2rgb(t1, t2, h);
		        var b = hue2rgb(t1, t2, h - 1 / 3);
		        return pack(r * 255, g * 255, b * 255, a);
		    };
		    var SUPPORTED_COLOR_FUNCTIONS = {
		        hsl: hsl,
		        hsla: hsl,
		        rgb: rgb,
		        rgba: rgb
		    };
		    var parseColor = function (context, value) {
		        return color$1.parse(context, Parser.create(value).parseComponentValue());
		    };
		    var COLORS = {
		        ALICEBLUE: 0xf0f8ffff,
		        ANTIQUEWHITE: 0xfaebd7ff,
		        AQUA: 0x00ffffff,
		        AQUAMARINE: 0x7fffd4ff,
		        AZURE: 0xf0ffffff,
		        BEIGE: 0xf5f5dcff,
		        BISQUE: 0xffe4c4ff,
		        BLACK: 0x000000ff,
		        BLANCHEDALMOND: 0xffebcdff,
		        BLUE: 0x0000ffff,
		        BLUEVIOLET: 0x8a2be2ff,
		        BROWN: 0xa52a2aff,
		        BURLYWOOD: 0xdeb887ff,
		        CADETBLUE: 0x5f9ea0ff,
		        CHARTREUSE: 0x7fff00ff,
		        CHOCOLATE: 0xd2691eff,
		        CORAL: 0xff7f50ff,
		        CORNFLOWERBLUE: 0x6495edff,
		        CORNSILK: 0xfff8dcff,
		        CRIMSON: 0xdc143cff,
		        CYAN: 0x00ffffff,
		        DARKBLUE: 0x00008bff,
		        DARKCYAN: 0x008b8bff,
		        DARKGOLDENROD: 0xb886bbff,
		        DARKGRAY: 0xa9a9a9ff,
		        DARKGREEN: 0x006400ff,
		        DARKGREY: 0xa9a9a9ff,
		        DARKKHAKI: 0xbdb76bff,
		        DARKMAGENTA: 0x8b008bff,
		        DARKOLIVEGREEN: 0x556b2fff,
		        DARKORANGE: 0xff8c00ff,
		        DARKORCHID: 0x9932ccff,
		        DARKRED: 0x8b0000ff,
		        DARKSALMON: 0xe9967aff,
		        DARKSEAGREEN: 0x8fbc8fff,
		        DARKSLATEBLUE: 0x483d8bff,
		        DARKSLATEGRAY: 0x2f4f4fff,
		        DARKSLATEGREY: 0x2f4f4fff,
		        DARKTURQUOISE: 0x00ced1ff,
		        DARKVIOLET: 0x9400d3ff,
		        DEEPPINK: 0xff1493ff,
		        DEEPSKYBLUE: 0x00bfffff,
		        DIMGRAY: 0x696969ff,
		        DIMGREY: 0x696969ff,
		        DODGERBLUE: 0x1e90ffff,
		        FIREBRICK: 0xb22222ff,
		        FLORALWHITE: 0xfffaf0ff,
		        FORESTGREEN: 0x228b22ff,
		        FUCHSIA: 0xff00ffff,
		        GAINSBORO: 0xdcdcdcff,
		        GHOSTWHITE: 0xf8f8ffff,
		        GOLD: 0xffd700ff,
		        GOLDENROD: 0xdaa520ff,
		        GRAY: 0x808080ff,
		        GREEN: 0x008000ff,
		        GREENYELLOW: 0xadff2fff,
		        GREY: 0x808080ff,
		        HONEYDEW: 0xf0fff0ff,
		        HOTPINK: 0xff69b4ff,
		        INDIANRED: 0xcd5c5cff,
		        INDIGO: 0x4b0082ff,
		        IVORY: 0xfffff0ff,
		        KHAKI: 0xf0e68cff,
		        LAVENDER: 0xe6e6faff,
		        LAVENDERBLUSH: 0xfff0f5ff,
		        LAWNGREEN: 0x7cfc00ff,
		        LEMONCHIFFON: 0xfffacdff,
		        LIGHTBLUE: 0xadd8e6ff,
		        LIGHTCORAL: 0xf08080ff,
		        LIGHTCYAN: 0xe0ffffff,
		        LIGHTGOLDENRODYELLOW: 0xfafad2ff,
		        LIGHTGRAY: 0xd3d3d3ff,
		        LIGHTGREEN: 0x90ee90ff,
		        LIGHTGREY: 0xd3d3d3ff,
		        LIGHTPINK: 0xffb6c1ff,
		        LIGHTSALMON: 0xffa07aff,
		        LIGHTSEAGREEN: 0x20b2aaff,
		        LIGHTSKYBLUE: 0x87cefaff,
		        LIGHTSLATEGRAY: 0x778899ff,
		        LIGHTSLATEGREY: 0x778899ff,
		        LIGHTSTEELBLUE: 0xb0c4deff,
		        LIGHTYELLOW: 0xffffe0ff,
		        LIME: 0x00ff00ff,
		        LIMEGREEN: 0x32cd32ff,
		        LINEN: 0xfaf0e6ff,
		        MAGENTA: 0xff00ffff,
		        MAROON: 0x800000ff,
		        MEDIUMAQUAMARINE: 0x66cdaaff,
		        MEDIUMBLUE: 0x0000cdff,
		        MEDIUMORCHID: 0xba55d3ff,
		        MEDIUMPURPLE: 0x9370dbff,
		        MEDIUMSEAGREEN: 0x3cb371ff,
		        MEDIUMSLATEBLUE: 0x7b68eeff,
		        MEDIUMSPRINGGREEN: 0x00fa9aff,
		        MEDIUMTURQUOISE: 0x48d1ccff,
		        MEDIUMVIOLETRED: 0xc71585ff,
		        MIDNIGHTBLUE: 0x191970ff,
		        MINTCREAM: 0xf5fffaff,
		        MISTYROSE: 0xffe4e1ff,
		        MOCCASIN: 0xffe4b5ff,
		        NAVAJOWHITE: 0xffdeadff,
		        NAVY: 0x000080ff,
		        OLDLACE: 0xfdf5e6ff,
		        OLIVE: 0x808000ff,
		        OLIVEDRAB: 0x6b8e23ff,
		        ORANGE: 0xffa500ff,
		        ORANGERED: 0xff4500ff,
		        ORCHID: 0xda70d6ff,
		        PALEGOLDENROD: 0xeee8aaff,
		        PALEGREEN: 0x98fb98ff,
		        PALETURQUOISE: 0xafeeeeff,
		        PALEVIOLETRED: 0xdb7093ff,
		        PAPAYAWHIP: 0xffefd5ff,
		        PEACHPUFF: 0xffdab9ff,
		        PERU: 0xcd853fff,
		        PINK: 0xffc0cbff,
		        PLUM: 0xdda0ddff,
		        POWDERBLUE: 0xb0e0e6ff,
		        PURPLE: 0x800080ff,
		        REBECCAPURPLE: 0x663399ff,
		        RED: 0xff0000ff,
		        ROSYBROWN: 0xbc8f8fff,
		        ROYALBLUE: 0x4169e1ff,
		        SADDLEBROWN: 0x8b4513ff,
		        SALMON: 0xfa8072ff,
		        SANDYBROWN: 0xf4a460ff,
		        SEAGREEN: 0x2e8b57ff,
		        SEASHELL: 0xfff5eeff,
		        SIENNA: 0xa0522dff,
		        SILVER: 0xc0c0c0ff,
		        SKYBLUE: 0x87ceebff,
		        SLATEBLUE: 0x6a5acdff,
		        SLATEGRAY: 0x708090ff,
		        SLATEGREY: 0x708090ff,
		        SNOW: 0xfffafaff,
		        SPRINGGREEN: 0x00ff7fff,
		        STEELBLUE: 0x4682b4ff,
		        TAN: 0xd2b48cff,
		        TEAL: 0x008080ff,
		        THISTLE: 0xd8bfd8ff,
		        TOMATO: 0xff6347ff,
		        TRANSPARENT: 0x00000000,
		        TURQUOISE: 0x40e0d0ff,
		        VIOLET: 0xee82eeff,
		        WHEAT: 0xf5deb3ff,
		        WHITE: 0xffffffff,
		        WHITESMOKE: 0xf5f5f5ff,
		        YELLOW: 0xffff00ff,
		        YELLOWGREEN: 0x9acd32ff
		    };

		    var backgroundClip = {
		        name: 'background-clip',
		        initialValue: 'border-box',
		        prefix: false,
		        type: 1 /* LIST */,
		        parse: function (_context, tokens) {
		            return tokens.map(function (token) {
		                if (isIdentToken(token)) {
		                    switch (token.value) {
		                        case 'padding-box':
		                            return 1 /* PADDING_BOX */;
		                        case 'content-box':
		                            return 2 /* CONTENT_BOX */;
		                    }
		                }
		                return 0 /* BORDER_BOX */;
		            });
		        }
		    };

		    var backgroundColor = {
		        name: "background-color",
		        initialValue: 'transparent',
		        prefix: false,
		        type: 3 /* TYPE_VALUE */,
		        format: 'color'
		    };

		    var parseColorStop = function (context, args) {
		        var color = color$1.parse(context, args[0]);
		        var stop = args[1];
		        return stop && isLengthPercentage(stop) ? { color: color, stop: stop } : { color: color, stop: null };
		    };
		    var processColorStops = function (stops, lineLength) {
		        var first = stops[0];
		        var last = stops[stops.length - 1];
		        if (first.stop === null) {
		            first.stop = ZERO_LENGTH;
		        }
		        if (last.stop === null) {
		            last.stop = HUNDRED_PERCENT;
		        }
		        var processStops = [];
		        var previous = 0;
		        for (var i = 0; i < stops.length; i++) {
		            var stop_1 = stops[i].stop;
		            if (stop_1 !== null) {
		                var absoluteValue = getAbsoluteValue(stop_1, lineLength);
		                if (absoluteValue > previous) {
		                    processStops.push(absoluteValue);
		                }
		                else {
		                    processStops.push(previous);
		                }
		                previous = absoluteValue;
		            }
		            else {
		                processStops.push(null);
		            }
		        }
		        var gapBegin = null;
		        for (var i = 0; i < processStops.length; i++) {
		            var stop_2 = processStops[i];
		            if (stop_2 === null) {
		                if (gapBegin === null) {
		                    gapBegin = i;
		                }
		            }
		            else if (gapBegin !== null) {
		                var gapLength = i - gapBegin;
		                var beforeGap = processStops[gapBegin - 1];
		                var gapValue = (stop_2 - beforeGap) / (gapLength + 1);
		                for (var g = 1; g <= gapLength; g++) {
		                    processStops[gapBegin + g - 1] = gapValue * g;
		                }
		                gapBegin = null;
		            }
		        }
		        return stops.map(function (_a, i) {
		            var color = _a.color;
		            return { color: color, stop: Math.max(Math.min(1, processStops[i] / lineLength), 0) };
		        });
		    };
		    var getAngleFromCorner = function (corner, width, height) {
		        var centerX = width / 2;
		        var centerY = height / 2;
		        var x = getAbsoluteValue(corner[0], width) - centerX;
		        var y = centerY - getAbsoluteValue(corner[1], height);
		        return (Math.atan2(y, x) + Math.PI * 2) % (Math.PI * 2);
		    };
		    var calculateGradientDirection = function (angle, width, height) {
		        var radian = typeof angle === 'number' ? angle : getAngleFromCorner(angle, width, height);
		        var lineLength = Math.abs(width * Math.sin(radian)) + Math.abs(height * Math.cos(radian));
		        var halfWidth = width / 2;
		        var halfHeight = height / 2;
		        var halfLineLength = lineLength / 2;
		        var yDiff = Math.sin(radian - Math.PI / 2) * halfLineLength;
		        var xDiff = Math.cos(radian - Math.PI / 2) * halfLineLength;
		        return [lineLength, halfWidth - xDiff, halfWidth + xDiff, halfHeight - yDiff, halfHeight + yDiff];
		    };
		    var distance = function (a, b) { return Math.sqrt(a * a + b * b); };
		    var findCorner = function (width, height, x, y, closest) {
		        var corners = [
		            [0, 0],
		            [0, height],
		            [width, 0],
		            [width, height]
		        ];
		        return corners.reduce(function (stat, corner) {
		            var cx = corner[0], cy = corner[1];
		            var d = distance(x - cx, y - cy);
		            if (closest ? d < stat.optimumDistance : d > stat.optimumDistance) {
		                return {
		                    optimumCorner: corner,
		                    optimumDistance: d
		                };
		            }
		            return stat;
		        }, {
		            optimumDistance: closest ? Infinity : -Infinity,
		            optimumCorner: null
		        }).optimumCorner;
		    };
		    var calculateRadius = function (gradient, x, y, width, height) {
		        var rx = 0;
		        var ry = 0;
		        switch (gradient.size) {
		            case 0 /* CLOSEST_SIDE */:
		                // The ending shape is sized so that that it exactly meets the side of the gradient box closest to the gradient’s center.
		                // If the shape is an ellipse, it exactly meets the closest side in each dimension.
		                if (gradient.shape === 0 /* CIRCLE */) {
		                    rx = ry = Math.min(Math.abs(x), Math.abs(x - width), Math.abs(y), Math.abs(y - height));
		                }
		                else if (gradient.shape === 1 /* ELLIPSE */) {
		                    rx = Math.min(Math.abs(x), Math.abs(x - width));
		                    ry = Math.min(Math.abs(y), Math.abs(y - height));
		                }
		                break;
		            case 2 /* CLOSEST_CORNER */:
		                // The ending shape is sized so that that it passes through the corner of the gradient box closest to the gradient’s center.
		                // If the shape is an ellipse, the ending shape is given the same aspect-ratio it would have if closest-side were specified.
		                if (gradient.shape === 0 /* CIRCLE */) {
		                    rx = ry = Math.min(distance(x, y), distance(x, y - height), distance(x - width, y), distance(x - width, y - height));
		                }
		                else if (gradient.shape === 1 /* ELLIPSE */) {
		                    // Compute the ratio ry/rx (which is to be the same as for "closest-side")
		                    var c = Math.min(Math.abs(y), Math.abs(y - height)) / Math.min(Math.abs(x), Math.abs(x - width));
		                    var _a = findCorner(width, height, x, y, true), cx = _a[0], cy = _a[1];
		                    rx = distance(cx - x, (cy - y) / c);
		                    ry = c * rx;
		                }
		                break;
		            case 1 /* FARTHEST_SIDE */:
		                // Same as closest-side, except the ending shape is sized based on the farthest side(s)
		                if (gradient.shape === 0 /* CIRCLE */) {
		                    rx = ry = Math.max(Math.abs(x), Math.abs(x - width), Math.abs(y), Math.abs(y - height));
		                }
		                else if (gradient.shape === 1 /* ELLIPSE */) {
		                    rx = Math.max(Math.abs(x), Math.abs(x - width));
		                    ry = Math.max(Math.abs(y), Math.abs(y - height));
		                }
		                break;
		            case 3 /* FARTHEST_CORNER */:
		                // Same as closest-corner, except the ending shape is sized based on the farthest corner.
		                // If the shape is an ellipse, the ending shape is given the same aspect ratio it would have if farthest-side were specified.
		                if (gradient.shape === 0 /* CIRCLE */) {
		                    rx = ry = Math.max(distance(x, y), distance(x, y - height), distance(x - width, y), distance(x - width, y - height));
		                }
		                else if (gradient.shape === 1 /* ELLIPSE */) {
		                    // Compute the ratio ry/rx (which is to be the same as for "farthest-side")
		                    var c = Math.max(Math.abs(y), Math.abs(y - height)) / Math.max(Math.abs(x), Math.abs(x - width));
		                    var _b = findCorner(width, height, x, y, false), cx = _b[0], cy = _b[1];
		                    rx = distance(cx - x, (cy - y) / c);
		                    ry = c * rx;
		                }
		                break;
		        }
		        if (Array.isArray(gradient.size)) {
		            rx = getAbsoluteValue(gradient.size[0], width);
		            ry = gradient.size.length === 2 ? getAbsoluteValue(gradient.size[1], height) : rx;
		        }
		        return [rx, ry];
		    };

		    var linearGradient = function (context, tokens) {
		        var angle$1 = deg(180);
		        var stops = [];
		        parseFunctionArgs(tokens).forEach(function (arg, i) {
		            if (i === 0) {
		                var firstToken = arg[0];
		                if (firstToken.type === 20 /* IDENT_TOKEN */ && firstToken.value === 'to') {
		                    angle$1 = parseNamedSide(arg);
		                    return;
		                }
		                else if (isAngle(firstToken)) {
		                    angle$1 = angle.parse(context, firstToken);
		                    return;
		                }
		            }
		            var colorStop = parseColorStop(context, arg);
		            stops.push(colorStop);
		        });
		        return { angle: angle$1, stops: stops, type: 1 /* LINEAR_GRADIENT */ };
		    };

		    var prefixLinearGradient = function (context, tokens) {
		        var angle$1 = deg(180);
		        var stops = [];
		        parseFunctionArgs(tokens).forEach(function (arg, i) {
		            if (i === 0) {
		                var firstToken = arg[0];
		                if (firstToken.type === 20 /* IDENT_TOKEN */ &&
		                    ['top', 'left', 'right', 'bottom'].indexOf(firstToken.value) !== -1) {
		                    angle$1 = parseNamedSide(arg);
		                    return;
		                }
		                else if (isAngle(firstToken)) {
		                    angle$1 = (angle.parse(context, firstToken) + deg(270)) % deg(360);
		                    return;
		                }
		            }
		            var colorStop = parseColorStop(context, arg);
		            stops.push(colorStop);
		        });
		        return {
		            angle: angle$1,
		            stops: stops,
		            type: 1 /* LINEAR_GRADIENT */
		        };
		    };

		    var webkitGradient = function (context, tokens) {
		        var angle = deg(180);
		        var stops = [];
		        var type = 1 /* LINEAR_GRADIENT */;
		        var shape = 0 /* CIRCLE */;
		        var size = 3 /* FARTHEST_CORNER */;
		        var position = [];
		        parseFunctionArgs(tokens).forEach(function (arg, i) {
		            var firstToken = arg[0];
		            if (i === 0) {
		                if (isIdentToken(firstToken) && firstToken.value === 'linear') {
		                    type = 1 /* LINEAR_GRADIENT */;
		                    return;
		                }
		                else if (isIdentToken(firstToken) && firstToken.value === 'radial') {
		                    type = 2 /* RADIAL_GRADIENT */;
		                    return;
		                }
		            }
		            if (firstToken.type === 18 /* FUNCTION */) {
		                if (firstToken.name === 'from') {
		                    var color = color$1.parse(context, firstToken.values[0]);
		                    stops.push({ stop: ZERO_LENGTH, color: color });
		                }
		                else if (firstToken.name === 'to') {
		                    var color = color$1.parse(context, firstToken.values[0]);
		                    stops.push({ stop: HUNDRED_PERCENT, color: color });
		                }
		                else if (firstToken.name === 'color-stop') {
		                    var values = firstToken.values.filter(nonFunctionArgSeparator);
		                    if (values.length === 2) {
		                        var color = color$1.parse(context, values[1]);
		                        var stop_1 = values[0];
		                        if (isNumberToken(stop_1)) {
		                            stops.push({
		                                stop: { type: 16 /* PERCENTAGE_TOKEN */, number: stop_1.number * 100, flags: stop_1.flags },
		                                color: color
		                            });
		                        }
		                    }
		                }
		            }
		        });
		        return type === 1 /* LINEAR_GRADIENT */
		            ? {
		                angle: (angle + deg(180)) % deg(360),
		                stops: stops,
		                type: type
		            }
		            : { size: size, shape: shape, stops: stops, position: position, type: type };
		    };

		    var CLOSEST_SIDE = 'closest-side';
		    var FARTHEST_SIDE = 'farthest-side';
		    var CLOSEST_CORNER = 'closest-corner';
		    var FARTHEST_CORNER = 'farthest-corner';
		    var CIRCLE = 'circle';
		    var ELLIPSE = 'ellipse';
		    var COVER = 'cover';
		    var CONTAIN = 'contain';
		    var radialGradient = function (context, tokens) {
		        var shape = 0 /* CIRCLE */;
		        var size = 3 /* FARTHEST_CORNER */;
		        var stops = [];
		        var position = [];
		        parseFunctionArgs(tokens).forEach(function (arg, i) {
		            var isColorStop = true;
		            if (i === 0) {
		                var isAtPosition_1 = false;
		                isColorStop = arg.reduce(function (acc, token) {
		                    if (isAtPosition_1) {
		                        if (isIdentToken(token)) {
		                            switch (token.value) {
		                                case 'center':
		                                    position.push(FIFTY_PERCENT);
		                                    return acc;
		                                case 'top':
		                                case 'left':
		                                    position.push(ZERO_LENGTH);
		                                    return acc;
		                                case 'right':
		                                case 'bottom':
		                                    position.push(HUNDRED_PERCENT);
		                                    return acc;
		                            }
		                        }
		                        else if (isLengthPercentage(token) || isLength(token)) {
		                            position.push(token);
		                        }
		                    }
		                    else if (isIdentToken(token)) {
		                        switch (token.value) {
		                            case CIRCLE:
		                                shape = 0 /* CIRCLE */;
		                                return false;
		                            case ELLIPSE:
		                                shape = 1 /* ELLIPSE */;
		                                return false;
		                            case 'at':
		                                isAtPosition_1 = true;
		                                return false;
		                            case CLOSEST_SIDE:
		                                size = 0 /* CLOSEST_SIDE */;
		                                return false;
		                            case COVER:
		                            case FARTHEST_SIDE:
		                                size = 1 /* FARTHEST_SIDE */;
		                                return false;
		                            case CONTAIN:
		                            case CLOSEST_CORNER:
		                                size = 2 /* CLOSEST_CORNER */;
		                                return false;
		                            case FARTHEST_CORNER:
		                                size = 3 /* FARTHEST_CORNER */;
		                                return false;
		                        }
		                    }
		                    else if (isLength(token) || isLengthPercentage(token)) {
		                        if (!Array.isArray(size)) {
		                            size = [];
		                        }
		                        size.push(token);
		                        return false;
		                    }
		                    return acc;
		                }, isColorStop);
		            }
		            if (isColorStop) {
		                var colorStop = parseColorStop(context, arg);
		                stops.push(colorStop);
		            }
		        });
		        return { size: size, shape: shape, stops: stops, position: position, type: 2 /* RADIAL_GRADIENT */ };
		    };

		    var prefixRadialGradient = function (context, tokens) {
		        var shape = 0 /* CIRCLE */;
		        var size = 3 /* FARTHEST_CORNER */;
		        var stops = [];
		        var position = [];
		        parseFunctionArgs(tokens).forEach(function (arg, i) {
		            var isColorStop = true;
		            if (i === 0) {
		                isColorStop = arg.reduce(function (acc, token) {
		                    if (isIdentToken(token)) {
		                        switch (token.value) {
		                            case 'center':
		                                position.push(FIFTY_PERCENT);
		                                return false;
		                            case 'top':
		                            case 'left':
		                                position.push(ZERO_LENGTH);
		                                return false;
		                            case 'right':
		                            case 'bottom':
		                                position.push(HUNDRED_PERCENT);
		                                return false;
		                        }
		                    }
		                    else if (isLengthPercentage(token) || isLength(token)) {
		                        position.push(token);
		                        return false;
		                    }
		                    return acc;
		                }, isColorStop);
		            }
		            else if (i === 1) {
		                isColorStop = arg.reduce(function (acc, token) {
		                    if (isIdentToken(token)) {
		                        switch (token.value) {
		                            case CIRCLE:
		                                shape = 0 /* CIRCLE */;
		                                return false;
		                            case ELLIPSE:
		                                shape = 1 /* ELLIPSE */;
		                                return false;
		                            case CONTAIN:
		                            case CLOSEST_SIDE:
		                                size = 0 /* CLOSEST_SIDE */;
		                                return false;
		                            case FARTHEST_SIDE:
		                                size = 1 /* FARTHEST_SIDE */;
		                                return false;
		                            case CLOSEST_CORNER:
		                                size = 2 /* CLOSEST_CORNER */;
		                                return false;
		                            case COVER:
		                            case FARTHEST_CORNER:
		                                size = 3 /* FARTHEST_CORNER */;
		                                return false;
		                        }
		                    }
		                    else if (isLength(token) || isLengthPercentage(token)) {
		                        if (!Array.isArray(size)) {
		                            size = [];
		                        }
		                        size.push(token);
		                        return false;
		                    }
		                    return acc;
		                }, isColorStop);
		            }
		            if (isColorStop) {
		                var colorStop = parseColorStop(context, arg);
		                stops.push(colorStop);
		            }
		        });
		        return { size: size, shape: shape, stops: stops, position: position, type: 2 /* RADIAL_GRADIENT */ };
		    };

		    var isLinearGradient = function (background) {
		        return background.type === 1 /* LINEAR_GRADIENT */;
		    };
		    var isRadialGradient = function (background) {
		        return background.type === 2 /* RADIAL_GRADIENT */;
		    };
		    var image = {
		        name: 'image',
		        parse: function (context, value) {
		            if (value.type === 22 /* URL_TOKEN */) {
		                var image_1 = { url: value.value, type: 0 /* URL */ };
		                context.cache.addImage(value.value);
		                return image_1;
		            }
		            if (value.type === 18 /* FUNCTION */) {
		                var imageFunction = SUPPORTED_IMAGE_FUNCTIONS[value.name];
		                if (typeof imageFunction === 'undefined') {
		                    throw new Error("Attempting to parse an unsupported image function \"" + value.name + "\"");
		                }
		                return imageFunction(context, value.values);
		            }
		            throw new Error("Unsupported image type " + value.type);
		        }
		    };
		    function isSupportedImage(value) {
		        return (!(value.type === 20 /* IDENT_TOKEN */ && value.value === 'none') &&
		            (value.type !== 18 /* FUNCTION */ || !!SUPPORTED_IMAGE_FUNCTIONS[value.name]));
		    }
		    var SUPPORTED_IMAGE_FUNCTIONS = {
		        'linear-gradient': linearGradient,
		        '-moz-linear-gradient': prefixLinearGradient,
		        '-ms-linear-gradient': prefixLinearGradient,
		        '-o-linear-gradient': prefixLinearGradient,
		        '-webkit-linear-gradient': prefixLinearGradient,
		        'radial-gradient': radialGradient,
		        '-moz-radial-gradient': prefixRadialGradient,
		        '-ms-radial-gradient': prefixRadialGradient,
		        '-o-radial-gradient': prefixRadialGradient,
		        '-webkit-radial-gradient': prefixRadialGradient,
		        '-webkit-gradient': webkitGradient
		    };

		    var backgroundImage = {
		        name: 'background-image',
		        initialValue: 'none',
		        type: 1 /* LIST */,
		        prefix: false,
		        parse: function (context, tokens) {
		            if (tokens.length === 0) {
		                return [];
		            }
		            var first = tokens[0];
		            if (first.type === 20 /* IDENT_TOKEN */ && first.value === 'none') {
		                return [];
		            }
		            return tokens
		                .filter(function (value) { return nonFunctionArgSeparator(value) && isSupportedImage(value); })
		                .map(function (value) { return image.parse(context, value); });
		        }
		    };

		    var backgroundOrigin = {
		        name: 'background-origin',
		        initialValue: 'border-box',
		        prefix: false,
		        type: 1 /* LIST */,
		        parse: function (_context, tokens) {
		            return tokens.map(function (token) {
		                if (isIdentToken(token)) {
		                    switch (token.value) {
		                        case 'padding-box':
		                            return 1 /* PADDING_BOX */;
		                        case 'content-box':
		                            return 2 /* CONTENT_BOX */;
		                    }
		                }
		                return 0 /* BORDER_BOX */;
		            });
		        }
		    };

		    var backgroundPosition = {
		        name: 'background-position',
		        initialValue: '0% 0%',
		        type: 1 /* LIST */,
		        prefix: false,
		        parse: function (_context, tokens) {
		            return parseFunctionArgs(tokens)
		                .map(function (values) { return values.filter(isLengthPercentage); })
		                .map(parseLengthPercentageTuple);
		        }
		    };

		    var backgroundRepeat = {
		        name: 'background-repeat',
		        initialValue: 'repeat',
		        prefix: false,
		        type: 1 /* LIST */,
		        parse: function (_context, tokens) {
		            return parseFunctionArgs(tokens)
		                .map(function (values) {
		                return values
		                    .filter(isIdentToken)
		                    .map(function (token) { return token.value; })
		                    .join(' ');
		            })
		                .map(parseBackgroundRepeat);
		        }
		    };
		    var parseBackgroundRepeat = function (value) {
		        switch (value) {
		            case 'no-repeat':
		                return 1 /* NO_REPEAT */;
		            case 'repeat-x':
		            case 'repeat no-repeat':
		                return 2 /* REPEAT_X */;
		            case 'repeat-y':
		            case 'no-repeat repeat':
		                return 3 /* REPEAT_Y */;
		            case 'repeat':
		            default:
		                return 0 /* REPEAT */;
		        }
		    };

		    var BACKGROUND_SIZE;
		    (function (BACKGROUND_SIZE) {
		        BACKGROUND_SIZE["AUTO"] = "auto";
		        BACKGROUND_SIZE["CONTAIN"] = "contain";
		        BACKGROUND_SIZE["COVER"] = "cover";
		    })(BACKGROUND_SIZE || (BACKGROUND_SIZE = {}));
		    var backgroundSize = {
		        name: 'background-size',
		        initialValue: '0',
		        prefix: false,
		        type: 1 /* LIST */,
		        parse: function (_context, tokens) {
		            return parseFunctionArgs(tokens).map(function (values) { return values.filter(isBackgroundSizeInfoToken); });
		        }
		    };
		    var isBackgroundSizeInfoToken = function (value) {
		        return isIdentToken(value) || isLengthPercentage(value);
		    };

		    var borderColorForSide = function (side) { return ({
		        name: "border-" + side + "-color",
		        initialValue: 'transparent',
		        prefix: false,
		        type: 3 /* TYPE_VALUE */,
		        format: 'color'
		    }); };
		    var borderTopColor = borderColorForSide('top');
		    var borderRightColor = borderColorForSide('right');
		    var borderBottomColor = borderColorForSide('bottom');
		    var borderLeftColor = borderColorForSide('left');

		    var borderRadiusForSide = function (side) { return ({
		        name: "border-radius-" + side,
		        initialValue: '0 0',
		        prefix: false,
		        type: 1 /* LIST */,
		        parse: function (_context, tokens) {
		            return parseLengthPercentageTuple(tokens.filter(isLengthPercentage));
		        }
		    }); };
		    var borderTopLeftRadius = borderRadiusForSide('top-left');
		    var borderTopRightRadius = borderRadiusForSide('top-right');
		    var borderBottomRightRadius = borderRadiusForSide('bottom-right');
		    var borderBottomLeftRadius = borderRadiusForSide('bottom-left');

		    var borderStyleForSide = function (side) { return ({
		        name: "border-" + side + "-style",
		        initialValue: 'solid',
		        prefix: false,
		        type: 2 /* IDENT_VALUE */,
		        parse: function (_context, style) {
		            switch (style) {
		                case 'none':
		                    return 0 /* NONE */;
		                case 'dashed':
		                    return 2 /* DASHED */;
		                case 'dotted':
		                    return 3 /* DOTTED */;
		                case 'double':
		                    return 4 /* DOUBLE */;
		            }
		            return 1 /* SOLID */;
		        }
		    }); };
		    var borderTopStyle = borderStyleForSide('top');
		    var borderRightStyle = borderStyleForSide('right');
		    var borderBottomStyle = borderStyleForSide('bottom');
		    var borderLeftStyle = borderStyleForSide('left');

		    var borderWidthForSide = function (side) { return ({
		        name: "border-" + side + "-width",
		        initialValue: '0',
		        type: 0 /* VALUE */,
		        prefix: false,
		        parse: function (_context, token) {
		            if (isDimensionToken(token)) {
		                return token.number;
		            }
		            return 0;
		        }
		    }); };
		    var borderTopWidth = borderWidthForSide('top');
		    var borderRightWidth = borderWidthForSide('right');
		    var borderBottomWidth = borderWidthForSide('bottom');
		    var borderLeftWidth = borderWidthForSide('left');

		    var color = {
		        name: "color",
		        initialValue: 'transparent',
		        prefix: false,
		        type: 3 /* TYPE_VALUE */,
		        format: 'color'
		    };

		    var direction = {
		        name: 'direction',
		        initialValue: 'ltr',
		        prefix: false,
		        type: 2 /* IDENT_VALUE */,
		        parse: function (_context, direction) {
		            switch (direction) {
		                case 'rtl':
		                    return 1 /* RTL */;
		                case 'ltr':
		                default:
		                    return 0 /* LTR */;
		            }
		        }
		    };

		    var display = {
		        name: 'display',
		        initialValue: 'inline-block',
		        prefix: false,
		        type: 1 /* LIST */,
		        parse: function (_context, tokens) {
		            return tokens.filter(isIdentToken).reduce(function (bit, token) {
		                return bit | parseDisplayValue(token.value);
		            }, 0 /* NONE */);
		        }
		    };
		    var parseDisplayValue = function (display) {
		        switch (display) {
		            case 'block':
		            case '-webkit-box':
		                return 2 /* BLOCK */;
		            case 'inline':
		                return 4 /* INLINE */;
		            case 'run-in':
		                return 8 /* RUN_IN */;
		            case 'flow':
		                return 16 /* FLOW */;
		            case 'flow-root':
		                return 32 /* FLOW_ROOT */;
		            case 'table':
		                return 64 /* TABLE */;
		            case 'flex':
		            case '-webkit-flex':
		                return 128 /* FLEX */;
		            case 'grid':
		            case '-ms-grid':
		                return 256 /* GRID */;
		            case 'ruby':
		                return 512 /* RUBY */;
		            case 'subgrid':
		                return 1024 /* SUBGRID */;
		            case 'list-item':
		                return 2048 /* LIST_ITEM */;
		            case 'table-row-group':
		                return 4096 /* TABLE_ROW_GROUP */;
		            case 'table-header-group':
		                return 8192 /* TABLE_HEADER_GROUP */;
		            case 'table-footer-group':
		                return 16384 /* TABLE_FOOTER_GROUP */;
		            case 'table-row':
		                return 32768 /* TABLE_ROW */;
		            case 'table-cell':
		                return 65536 /* TABLE_CELL */;
		            case 'table-column-group':
		                return 131072 /* TABLE_COLUMN_GROUP */;
		            case 'table-column':
		                return 262144 /* TABLE_COLUMN */;
		            case 'table-caption':
		                return 524288 /* TABLE_CAPTION */;
		            case 'ruby-base':
		                return 1048576 /* RUBY_BASE */;
		            case 'ruby-text':
		                return 2097152 /* RUBY_TEXT */;
		            case 'ruby-base-container':
		                return 4194304 /* RUBY_BASE_CONTAINER */;
		            case 'ruby-text-container':
		                return 8388608 /* RUBY_TEXT_CONTAINER */;
		            case 'contents':
		                return 16777216 /* CONTENTS */;
		            case 'inline-block':
		                return 33554432 /* INLINE_BLOCK */;
		            case 'inline-list-item':
		                return 67108864 /* INLINE_LIST_ITEM */;
		            case 'inline-table':
		                return 134217728 /* INLINE_TABLE */;
		            case 'inline-flex':
		                return 268435456 /* INLINE_FLEX */;
		            case 'inline-grid':
		                return 536870912 /* INLINE_GRID */;
		        }
		        return 0 /* NONE */;
		    };

		    var float = {
		        name: 'float',
		        initialValue: 'none',
		        prefix: false,
		        type: 2 /* IDENT_VALUE */,
		        parse: function (_context, float) {
		            switch (float) {
		                case 'left':
		                    return 1 /* LEFT */;
		                case 'right':
		                    return 2 /* RIGHT */;
		                case 'inline-start':
		                    return 3 /* INLINE_START */;
		                case 'inline-end':
		                    return 4 /* INLINE_END */;
		            }
		            return 0 /* NONE */;
		        }
		    };

		    var letterSpacing = {
		        name: 'letter-spacing',
		        initialValue: '0',
		        prefix: false,
		        type: 0 /* VALUE */,
		        parse: function (_context, token) {
		            if (token.type === 20 /* IDENT_TOKEN */ && token.value === 'normal') {
		                return 0;
		            }
		            if (token.type === 17 /* NUMBER_TOKEN */) {
		                return token.number;
		            }
		            if (token.type === 15 /* DIMENSION_TOKEN */) {
		                return token.number;
		            }
		            return 0;
		        }
		    };

		    var LINE_BREAK;
		    (function (LINE_BREAK) {
		        LINE_BREAK["NORMAL"] = "normal";
		        LINE_BREAK["STRICT"] = "strict";
		    })(LINE_BREAK || (LINE_BREAK = {}));
		    var lineBreak = {
		        name: 'line-break',
		        initialValue: 'normal',
		        prefix: false,
		        type: 2 /* IDENT_VALUE */,
		        parse: function (_context, lineBreak) {
		            switch (lineBreak) {
		                case 'strict':
		                    return LINE_BREAK.STRICT;
		                case 'normal':
		                default:
		                    return LINE_BREAK.NORMAL;
		            }
		        }
		    };

		    var lineHeight = {
		        name: 'line-height',
		        initialValue: 'normal',
		        prefix: false,
		        type: 4 /* TOKEN_VALUE */
		    };
		    var computeLineHeight = function (token, fontSize) {
		        if (isIdentToken(token) && token.value === 'normal') {
		            return 1.2 * fontSize;
		        }
		        else if (token.type === 17 /* NUMBER_TOKEN */) {
		            return fontSize * token.number;
		        }
		        else if (isLengthPercentage(token)) {
		            return getAbsoluteValue(token, fontSize);
		        }
		        return fontSize;
		    };

		    var listStyleImage = {
		        name: 'list-style-image',
		        initialValue: 'none',
		        type: 0 /* VALUE */,
		        prefix: false,
		        parse: function (context, token) {
		            if (token.type === 20 /* IDENT_TOKEN */ && token.value === 'none') {
		                return null;
		            }
		            return image.parse(context, token);
		        }
		    };

		    var listStylePosition = {
		        name: 'list-style-position',
		        initialValue: 'outside',
		        prefix: false,
		        type: 2 /* IDENT_VALUE */,
		        parse: function (_context, position) {
		            switch (position) {
		                case 'inside':
		                    return 0 /* INSIDE */;
		                case 'outside':
		                default:
		                    return 1 /* OUTSIDE */;
		            }
		        }
		    };

		    var listStyleType = {
		        name: 'list-style-type',
		        initialValue: 'none',
		        prefix: false,
		        type: 2 /* IDENT_VALUE */,
		        parse: function (_context, type) {
		            switch (type) {
		                case 'disc':
		                    return 0 /* DISC */;
		                case 'circle':
		                    return 1 /* CIRCLE */;
		                case 'square':
		                    return 2 /* SQUARE */;
		                case 'decimal':
		                    return 3 /* DECIMAL */;
		                case 'cjk-decimal':
		                    return 4 /* CJK_DECIMAL */;
		                case 'decimal-leading-zero':
		                    return 5 /* DECIMAL_LEADING_ZERO */;
		                case 'lower-roman':
		                    return 6 /* LOWER_ROMAN */;
		                case 'upper-roman':
		                    return 7 /* UPPER_ROMAN */;
		                case 'lower-greek':
		                    return 8 /* LOWER_GREEK */;
		                case 'lower-alpha':
		                    return 9 /* LOWER_ALPHA */;
		                case 'upper-alpha':
		                    return 10 /* UPPER_ALPHA */;
		                case 'arabic-indic':
		                    return 11 /* ARABIC_INDIC */;
		                case 'armenian':
		                    return 12 /* ARMENIAN */;
		                case 'bengali':
		                    return 13 /* BENGALI */;
		                case 'cambodian':
		                    return 14 /* CAMBODIAN */;
		                case 'cjk-earthly-branch':
		                    return 15 /* CJK_EARTHLY_BRANCH */;
		                case 'cjk-heavenly-stem':
		                    return 16 /* CJK_HEAVENLY_STEM */;
		                case 'cjk-ideographic':
		                    return 17 /* CJK_IDEOGRAPHIC */;
		                case 'devanagari':
		                    return 18 /* DEVANAGARI */;
		                case 'ethiopic-numeric':
		                    return 19 /* ETHIOPIC_NUMERIC */;
		                case 'georgian':
		                    return 20 /* GEORGIAN */;
		                case 'gujarati':
		                    return 21 /* GUJARATI */;
		                case 'gurmukhi':
		                    return 22 /* GURMUKHI */;
		                case 'hebrew':
		                    return 22 /* HEBREW */;
		                case 'hiragana':
		                    return 23 /* HIRAGANA */;
		                case 'hiragana-iroha':
		                    return 24 /* HIRAGANA_IROHA */;
		                case 'japanese-formal':
		                    return 25 /* JAPANESE_FORMAL */;
		                case 'japanese-informal':
		                    return 26 /* JAPANESE_INFORMAL */;
		                case 'kannada':
		                    return 27 /* KANNADA */;
		                case 'katakana':
		                    return 28 /* KATAKANA */;
		                case 'katakana-iroha':
		                    return 29 /* KATAKANA_IROHA */;
		                case 'khmer':
		                    return 30 /* KHMER */;
		                case 'korean-hangul-formal':
		                    return 31 /* KOREAN_HANGUL_FORMAL */;
		                case 'korean-hanja-formal':
		                    return 32 /* KOREAN_HANJA_FORMAL */;
		                case 'korean-hanja-informal':
		                    return 33 /* KOREAN_HANJA_INFORMAL */;
		                case 'lao':
		                    return 34 /* LAO */;
		                case 'lower-armenian':
		                    return 35 /* LOWER_ARMENIAN */;
		                case 'malayalam':
		                    return 36 /* MALAYALAM */;
		                case 'mongolian':
		                    return 37 /* MONGOLIAN */;
		                case 'myanmar':
		                    return 38 /* MYANMAR */;
		                case 'oriya':
		                    return 39 /* ORIYA */;
		                case 'persian':
		                    return 40 /* PERSIAN */;
		                case 'simp-chinese-formal':
		                    return 41 /* SIMP_CHINESE_FORMAL */;
		                case 'simp-chinese-informal':
		                    return 42 /* SIMP_CHINESE_INFORMAL */;
		                case 'tamil':
		                    return 43 /* TAMIL */;
		                case 'telugu':
		                    return 44 /* TELUGU */;
		                case 'thai':
		                    return 45 /* THAI */;
		                case 'tibetan':
		                    return 46 /* TIBETAN */;
		                case 'trad-chinese-formal':
		                    return 47 /* TRAD_CHINESE_FORMAL */;
		                case 'trad-chinese-informal':
		                    return 48 /* TRAD_CHINESE_INFORMAL */;
		                case 'upper-armenian':
		                    return 49 /* UPPER_ARMENIAN */;
		                case 'disclosure-open':
		                    return 50 /* DISCLOSURE_OPEN */;
		                case 'disclosure-closed':
		                    return 51 /* DISCLOSURE_CLOSED */;
		                case 'none':
		                default:
		                    return -1 /* NONE */;
		            }
		        }
		    };

		    var marginForSide = function (side) { return ({
		        name: "margin-" + side,
		        initialValue: '0',
		        prefix: false,
		        type: 4 /* TOKEN_VALUE */
		    }); };
		    var marginTop = marginForSide('top');
		    var marginRight = marginForSide('right');
		    var marginBottom = marginForSide('bottom');
		    var marginLeft = marginForSide('left');

		    var overflow = {
		        name: 'overflow',
		        initialValue: 'visible',
		        prefix: false,
		        type: 1 /* LIST */,
		        parse: function (_context, tokens) {
		            return tokens.filter(isIdentToken).map(function (overflow) {
		                switch (overflow.value) {
		                    case 'hidden':
		                        return 1 /* HIDDEN */;
		                    case 'scroll':
		                        return 2 /* SCROLL */;
		                    case 'clip':
		                        return 3 /* CLIP */;
		                    case 'auto':
		                        return 4 /* AUTO */;
		                    case 'visible':
		                    default:
		                        return 0 /* VISIBLE */;
		                }
		            });
		        }
		    };

		    var overflowWrap = {
		        name: 'overflow-wrap',
		        initialValue: 'normal',
		        prefix: false,
		        type: 2 /* IDENT_VALUE */,
		        parse: function (_context, overflow) {
		            switch (overflow) {
		                case 'break-word':
		                    return "break-word" /* BREAK_WORD */;
		                case 'normal':
		                default:
		                    return "normal" /* NORMAL */;
		            }
		        }
		    };

		    var paddingForSide = function (side) { return ({
		        name: "padding-" + side,
		        initialValue: '0',
		        prefix: false,
		        type: 3 /* TYPE_VALUE */,
		        format: 'length-percentage'
		    }); };
		    var paddingTop = paddingForSide('top');
		    var paddingRight = paddingForSide('right');
		    var paddingBottom = paddingForSide('bottom');
		    var paddingLeft = paddingForSide('left');

		    var textAlign = {
		        name: 'text-align',
		        initialValue: 'left',
		        prefix: false,
		        type: 2 /* IDENT_VALUE */,
		        parse: function (_context, textAlign) {
		            switch (textAlign) {
		                case 'right':
		                    return 2 /* RIGHT */;
		                case 'center':
		                case 'justify':
		                    return 1 /* CENTER */;
		                case 'left':
		                default:
		                    return 0 /* LEFT */;
		            }
		        }
		    };

		    var position = {
		        name: 'position',
		        initialValue: 'static',
		        prefix: false,
		        type: 2 /* IDENT_VALUE */,
		        parse: function (_context, position) {
		            switch (position) {
		                case 'relative':
		                    return 1 /* RELATIVE */;
		                case 'absolute':
		                    return 2 /* ABSOLUTE */;
		                case 'fixed':
		                    return 3 /* FIXED */;
		                case 'sticky':
		                    return 4 /* STICKY */;
		            }
		            return 0 /* STATIC */;
		        }
		    };

		    var textShadow = {
		        name: 'text-shadow',
		        initialValue: 'none',
		        type: 1 /* LIST */,
		        prefix: false,
		        parse: function (context, tokens) {
		            if (tokens.length === 1 && isIdentWithValue(tokens[0], 'none')) {
		                return [];
		            }
		            return parseFunctionArgs(tokens).map(function (values) {
		                var shadow = {
		                    color: COLORS.TRANSPARENT,
		                    offsetX: ZERO_LENGTH,
		                    offsetY: ZERO_LENGTH,
		                    blur: ZERO_LENGTH
		                };
		                var c = 0;
		                for (var i = 0; i < values.length; i++) {
		                    var token = values[i];
		                    if (isLength(token)) {
		                        if (c === 0) {
		                            shadow.offsetX = token;
		                        }
		                        else if (c === 1) {
		                            shadow.offsetY = token;
		                        }
		                        else {
		                            shadow.blur = token;
		                        }
		                        c++;
		                    }
		                    else {
		                        shadow.color = color$1.parse(context, token);
		                    }
		                }
		                return shadow;
		            });
		        }
		    };

		    var textTransform = {
		        name: 'text-transform',
		        initialValue: 'none',
		        prefix: false,
		        type: 2 /* IDENT_VALUE */,
		        parse: function (_context, textTransform) {
		            switch (textTransform) {
		                case 'uppercase':
		                    return 2 /* UPPERCASE */;
		                case 'lowercase':
		                    return 1 /* LOWERCASE */;
		                case 'capitalize':
		                    return 3 /* CAPITALIZE */;
		            }
		            return 0 /* NONE */;
		        }
		    };

		    var transform$1 = {
		        name: 'transform',
		        initialValue: 'none',
		        prefix: true,
		        type: 0 /* VALUE */,
		        parse: function (_context, token) {
		            if (token.type === 20 /* IDENT_TOKEN */ && token.value === 'none') {
		                return null;
		            }
		            if (token.type === 18 /* FUNCTION */) {
		                var transformFunction = SUPPORTED_TRANSFORM_FUNCTIONS[token.name];
		                if (typeof transformFunction === 'undefined') {
		                    throw new Error("Attempting to parse an unsupported transform function \"" + token.name + "\"");
		                }
		                return transformFunction(token.values);
		            }
		            return null;
		        }
		    };
		    var matrix = function (args) {
		        var values = args.filter(function (arg) { return arg.type === 17 /* NUMBER_TOKEN */; }).map(function (arg) { return arg.number; });
		        return values.length === 6 ? values : null;
		    };
		    // doesn't support 3D transforms at the moment
		    var matrix3d = function (args) {
		        var values = args.filter(function (arg) { return arg.type === 17 /* NUMBER_TOKEN */; }).map(function (arg) { return arg.number; });
		        var a1 = values[0], b1 = values[1]; values[2]; values[3]; var a2 = values[4], b2 = values[5]; values[6]; values[7]; values[8]; values[9]; values[10]; values[11]; var a4 = values[12], b4 = values[13]; values[14]; values[15];
		        return values.length === 16 ? [a1, b1, a2, b2, a4, b4] : null;
		    };
		    var SUPPORTED_TRANSFORM_FUNCTIONS = {
		        matrix: matrix,
		        matrix3d: matrix3d
		    };

		    var DEFAULT_VALUE = {
		        type: 16 /* PERCENTAGE_TOKEN */,
		        number: 50,
		        flags: FLAG_INTEGER
		    };
		    var DEFAULT = [DEFAULT_VALUE, DEFAULT_VALUE];
		    var transformOrigin = {
		        name: 'transform-origin',
		        initialValue: '50% 50%',
		        prefix: true,
		        type: 1 /* LIST */,
		        parse: function (_context, tokens) {
		            var origins = tokens.filter(isLengthPercentage);
		            if (origins.length !== 2) {
		                return DEFAULT;
		            }
		            return [origins[0], origins[1]];
		        }
		    };

		    var visibility = {
		        name: 'visible',
		        initialValue: 'none',
		        prefix: false,
		        type: 2 /* IDENT_VALUE */,
		        parse: function (_context, visibility) {
		            switch (visibility) {
		                case 'hidden':
		                    return 1 /* HIDDEN */;
		                case 'collapse':
		                    return 2 /* COLLAPSE */;
		                case 'visible':
		                default:
		                    return 0 /* VISIBLE */;
		            }
		        }
		    };

		    var WORD_BREAK;
		    (function (WORD_BREAK) {
		        WORD_BREAK["NORMAL"] = "normal";
		        WORD_BREAK["BREAK_ALL"] = "break-all";
		        WORD_BREAK["KEEP_ALL"] = "keep-all";
		    })(WORD_BREAK || (WORD_BREAK = {}));
		    var wordBreak = {
		        name: 'word-break',
		        initialValue: 'normal',
		        prefix: false,
		        type: 2 /* IDENT_VALUE */,
		        parse: function (_context, wordBreak) {
		            switch (wordBreak) {
		                case 'break-all':
		                    return WORD_BREAK.BREAK_ALL;
		                case 'keep-all':
		                    return WORD_BREAK.KEEP_ALL;
		                case 'normal':
		                default:
		                    return WORD_BREAK.NORMAL;
		            }
		        }
		    };

		    var zIndex = {
		        name: 'z-index',
		        initialValue: 'auto',
		        prefix: false,
		        type: 0 /* VALUE */,
		        parse: function (_context, token) {
		            if (token.type === 20 /* IDENT_TOKEN */) {
		                return { auto: true, order: 0 };
		            }
		            if (isNumberToken(token)) {
		                return { auto: false, order: token.number };
		            }
		            throw new Error("Invalid z-index number parsed");
		        }
		    };

		    var time = {
		        name: 'time',
		        parse: function (_context, value) {
		            if (value.type === 15 /* DIMENSION_TOKEN */) {
		                switch (value.unit.toLowerCase()) {
		                    case 's':
		                        return 1000 * value.number;
		                    case 'ms':
		                        return value.number;
		                }
		            }
		            throw new Error("Unsupported time type");
		        }
		    };

		    var opacity = {
		        name: 'opacity',
		        initialValue: '1',
		        type: 0 /* VALUE */,
		        prefix: false,
		        parse: function (_context, token) {
		            if (isNumberToken(token)) {
		                return token.number;
		            }
		            return 1;
		        }
		    };

		    var textDecorationColor = {
		        name: "text-decoration-color",
		        initialValue: 'transparent',
		        prefix: false,
		        type: 3 /* TYPE_VALUE */,
		        format: 'color'
		    };

		    var textDecorationLine = {
		        name: 'text-decoration-line',
		        initialValue: 'none',
		        prefix: false,
		        type: 1 /* LIST */,
		        parse: function (_context, tokens) {
		            return tokens
		                .filter(isIdentToken)
		                .map(function (token) {
		                switch (token.value) {
		                    case 'underline':
		                        return 1 /* UNDERLINE */;
		                    case 'overline':
		                        return 2 /* OVERLINE */;
		                    case 'line-through':
		                        return 3 /* LINE_THROUGH */;
		                    case 'none':
		                        return 4 /* BLINK */;
		                }
		                return 0 /* NONE */;
		            })
		                .filter(function (line) { return line !== 0 /* NONE */; });
		        }
		    };

		    var fontFamily = {
		        name: "font-family",
		        initialValue: '',
		        prefix: false,
		        type: 1 /* LIST */,
		        parse: function (_context, tokens) {
		            var accumulator = [];
		            var results = [];
		            tokens.forEach(function (token) {
		                switch (token.type) {
		                    case 20 /* IDENT_TOKEN */:
		                    case 0 /* STRING_TOKEN */:
		                        accumulator.push(token.value);
		                        break;
		                    case 17 /* NUMBER_TOKEN */:
		                        accumulator.push(token.number.toString());
		                        break;
		                    case 4 /* COMMA_TOKEN */:
		                        results.push(accumulator.join(' '));
		                        accumulator.length = 0;
		                        break;
		                }
		            });
		            if (accumulator.length) {
		                results.push(accumulator.join(' '));
		            }
		            return results.map(function (result) { return (result.indexOf(' ') === -1 ? result : "'" + result + "'"); });
		        }
		    };

		    var fontSize = {
		        name: "font-size",
		        initialValue: '0',
		        prefix: false,
		        type: 3 /* TYPE_VALUE */,
		        format: 'length'
		    };

		    var fontWeight = {
		        name: 'font-weight',
		        initialValue: 'normal',
		        type: 0 /* VALUE */,
		        prefix: false,
		        parse: function (_context, token) {
		            if (isNumberToken(token)) {
		                return token.number;
		            }
		            if (isIdentToken(token)) {
		                switch (token.value) {
		                    case 'bold':
		                        return 700;
		                    case 'normal':
		                    default:
		                        return 400;
		                }
		            }
		            return 400;
		        }
		    };

		    var fontVariant = {
		        name: 'font-variant',
		        initialValue: 'none',
		        type: 1 /* LIST */,
		        prefix: false,
		        parse: function (_context, tokens) {
		            return tokens.filter(isIdentToken).map(function (token) { return token.value; });
		        }
		    };

		    var fontStyle = {
		        name: 'font-style',
		        initialValue: 'normal',
		        prefix: false,
		        type: 2 /* IDENT_VALUE */,
		        parse: function (_context, overflow) {
		            switch (overflow) {
		                case 'oblique':
		                    return "oblique" /* OBLIQUE */;
		                case 'italic':
		                    return "italic" /* ITALIC */;
		                case 'normal':
		                default:
		                    return "normal" /* NORMAL */;
		            }
		        }
		    };

		    var contains = function (bit, value) { return (bit & value) !== 0; };

		    var content = {
		        name: 'content',
		        initialValue: 'none',
		        type: 1 /* LIST */,
		        prefix: false,
		        parse: function (_context, tokens) {
		            if (tokens.length === 0) {
		                return [];
		            }
		            var first = tokens[0];
		            if (first.type === 20 /* IDENT_TOKEN */ && first.value === 'none') {
		                return [];
		            }
		            return tokens;
		        }
		    };

		    var counterIncrement = {
		        name: 'counter-increment',
		        initialValue: 'none',
		        prefix: true,
		        type: 1 /* LIST */,
		        parse: function (_context, tokens) {
		            if (tokens.length === 0) {
		                return null;
		            }
		            var first = tokens[0];
		            if (first.type === 20 /* IDENT_TOKEN */ && first.value === 'none') {
		                return null;
		            }
		            var increments = [];
		            var filtered = tokens.filter(nonWhiteSpace);
		            for (var i = 0; i < filtered.length; i++) {
		                var counter = filtered[i];
		                var next = filtered[i + 1];
		                if (counter.type === 20 /* IDENT_TOKEN */) {
		                    var increment = next && isNumberToken(next) ? next.number : 1;
		                    increments.push({ counter: counter.value, increment: increment });
		                }
		            }
		            return increments;
		        }
		    };

		    var counterReset = {
		        name: 'counter-reset',
		        initialValue: 'none',
		        prefix: true,
		        type: 1 /* LIST */,
		        parse: function (_context, tokens) {
		            if (tokens.length === 0) {
		                return [];
		            }
		            var resets = [];
		            var filtered = tokens.filter(nonWhiteSpace);
		            for (var i = 0; i < filtered.length; i++) {
		                var counter = filtered[i];
		                var next = filtered[i + 1];
		                if (isIdentToken(counter) && counter.value !== 'none') {
		                    var reset = next && isNumberToken(next) ? next.number : 0;
		                    resets.push({ counter: counter.value, reset: reset });
		                }
		            }
		            return resets;
		        }
		    };

		    var duration = {
		        name: 'duration',
		        initialValue: '0s',
		        prefix: false,
		        type: 1 /* LIST */,
		        parse: function (context, tokens) {
		            return tokens.filter(isDimensionToken).map(function (token) { return time.parse(context, token); });
		        }
		    };

		    var quotes = {
		        name: 'quotes',
		        initialValue: 'none',
		        prefix: true,
		        type: 1 /* LIST */,
		        parse: function (_context, tokens) {
		            if (tokens.length === 0) {
		                return null;
		            }
		            var first = tokens[0];
		            if (first.type === 20 /* IDENT_TOKEN */ && first.value === 'none') {
		                return null;
		            }
		            var quotes = [];
		            var filtered = tokens.filter(isStringToken);
		            if (filtered.length % 2 !== 0) {
		                return null;
		            }
		            for (var i = 0; i < filtered.length; i += 2) {
		                var open_1 = filtered[i].value;
		                var close_1 = filtered[i + 1].value;
		                quotes.push({ open: open_1, close: close_1 });
		            }
		            return quotes;
		        }
		    };
		    var getQuote = function (quotes, depth, open) {
		        if (!quotes) {
		            return '';
		        }
		        var quote = quotes[Math.min(depth, quotes.length - 1)];
		        if (!quote) {
		            return '';
		        }
		        return open ? quote.open : quote.close;
		    };

		    var boxShadow = {
		        name: 'box-shadow',
		        initialValue: 'none',
		        type: 1 /* LIST */,
		        prefix: false,
		        parse: function (context, tokens) {
		            if (tokens.length === 1 && isIdentWithValue(tokens[0], 'none')) {
		                return [];
		            }
		            return parseFunctionArgs(tokens).map(function (values) {
		                var shadow = {
		                    color: 0x000000ff,
		                    offsetX: ZERO_LENGTH,
		                    offsetY: ZERO_LENGTH,
		                    blur: ZERO_LENGTH,
		                    spread: ZERO_LENGTH,
		                    inset: false
		                };
		                var c = 0;
		                for (var i = 0; i < values.length; i++) {
		                    var token = values[i];
		                    if (isIdentWithValue(token, 'inset')) {
		                        shadow.inset = true;
		                    }
		                    else if (isLength(token)) {
		                        if (c === 0) {
		                            shadow.offsetX = token;
		                        }
		                        else if (c === 1) {
		                            shadow.offsetY = token;
		                        }
		                        else if (c === 2) {
		                            shadow.blur = token;
		                        }
		                        else {
		                            shadow.spread = token;
		                        }
		                        c++;
		                    }
		                    else {
		                        shadow.color = color$1.parse(context, token);
		                    }
		                }
		                return shadow;
		            });
		        }
		    };

		    var paintOrder = {
		        name: 'paint-order',
		        initialValue: 'normal',
		        prefix: false,
		        type: 1 /* LIST */,
		        parse: function (_context, tokens) {
		            var DEFAULT_VALUE = [0 /* FILL */, 1 /* STROKE */, 2 /* MARKERS */];
		            var layers = [];
		            tokens.filter(isIdentToken).forEach(function (token) {
		                switch (token.value) {
		                    case 'stroke':
		                        layers.push(1 /* STROKE */);
		                        break;
		                    case 'fill':
		                        layers.push(0 /* FILL */);
		                        break;
		                    case 'markers':
		                        layers.push(2 /* MARKERS */);
		                        break;
		                }
		            });
		            DEFAULT_VALUE.forEach(function (value) {
		                if (layers.indexOf(value) === -1) {
		                    layers.push(value);
		                }
		            });
		            return layers;
		        }
		    };

		    var webkitTextStrokeColor = {
		        name: "-webkit-text-stroke-color",
		        initialValue: 'currentcolor',
		        prefix: false,
		        type: 3 /* TYPE_VALUE */,
		        format: 'color'
		    };

		    var webkitTextStrokeWidth = {
		        name: "-webkit-text-stroke-width",
		        initialValue: '0',
		        type: 0 /* VALUE */,
		        prefix: false,
		        parse: function (_context, token) {
		            if (isDimensionToken(token)) {
		                return token.number;
		            }
		            return 0;
		        }
		    };

		    var CSSParsedDeclaration = /** @class */ (function () {
		        function CSSParsedDeclaration(context, declaration) {
		            var _a, _b;
		            this.animationDuration = parse(context, duration, declaration.animationDuration);
		            this.backgroundClip = parse(context, backgroundClip, declaration.backgroundClip);
		            this.backgroundColor = parse(context, backgroundColor, declaration.backgroundColor);
		            this.backgroundImage = parse(context, backgroundImage, declaration.backgroundImage);
		            this.backgroundOrigin = parse(context, backgroundOrigin, declaration.backgroundOrigin);
		            this.backgroundPosition = parse(context, backgroundPosition, declaration.backgroundPosition);
		            this.backgroundRepeat = parse(context, backgroundRepeat, declaration.backgroundRepeat);
		            this.backgroundSize = parse(context, backgroundSize, declaration.backgroundSize);
		            this.borderTopColor = parse(context, borderTopColor, declaration.borderTopColor);
		            this.borderRightColor = parse(context, borderRightColor, declaration.borderRightColor);
		            this.borderBottomColor = parse(context, borderBottomColor, declaration.borderBottomColor);
		            this.borderLeftColor = parse(context, borderLeftColor, declaration.borderLeftColor);
		            this.borderTopLeftRadius = parse(context, borderTopLeftRadius, declaration.borderTopLeftRadius);
		            this.borderTopRightRadius = parse(context, borderTopRightRadius, declaration.borderTopRightRadius);
		            this.borderBottomRightRadius = parse(context, borderBottomRightRadius, declaration.borderBottomRightRadius);
		            this.borderBottomLeftRadius = parse(context, borderBottomLeftRadius, declaration.borderBottomLeftRadius);
		            this.borderTopStyle = parse(context, borderTopStyle, declaration.borderTopStyle);
		            this.borderRightStyle = parse(context, borderRightStyle, declaration.borderRightStyle);
		            this.borderBottomStyle = parse(context, borderBottomStyle, declaration.borderBottomStyle);
		            this.borderLeftStyle = parse(context, borderLeftStyle, declaration.borderLeftStyle);
		            this.borderTopWidth = parse(context, borderTopWidth, declaration.borderTopWidth);
		            this.borderRightWidth = parse(context, borderRightWidth, declaration.borderRightWidth);
		            this.borderBottomWidth = parse(context, borderBottomWidth, declaration.borderBottomWidth);
		            this.borderLeftWidth = parse(context, borderLeftWidth, declaration.borderLeftWidth);
		            this.boxShadow = parse(context, boxShadow, declaration.boxShadow);
		            this.color = parse(context, color, declaration.color);
		            this.direction = parse(context, direction, declaration.direction);
		            this.display = parse(context, display, declaration.display);
		            this.float = parse(context, float, declaration.cssFloat);
		            this.fontFamily = parse(context, fontFamily, declaration.fontFamily);
		            this.fontSize = parse(context, fontSize, declaration.fontSize);
		            this.fontStyle = parse(context, fontStyle, declaration.fontStyle);
		            this.fontVariant = parse(context, fontVariant, declaration.fontVariant);
		            this.fontWeight = parse(context, fontWeight, declaration.fontWeight);
		            this.letterSpacing = parse(context, letterSpacing, declaration.letterSpacing);
		            this.lineBreak = parse(context, lineBreak, declaration.lineBreak);
		            this.lineHeight = parse(context, lineHeight, declaration.lineHeight);
		            this.listStyleImage = parse(context, listStyleImage, declaration.listStyleImage);
		            this.listStylePosition = parse(context, listStylePosition, declaration.listStylePosition);
		            this.listStyleType = parse(context, listStyleType, declaration.listStyleType);
		            this.marginTop = parse(context, marginTop, declaration.marginTop);
		            this.marginRight = parse(context, marginRight, declaration.marginRight);
		            this.marginBottom = parse(context, marginBottom, declaration.marginBottom);
		            this.marginLeft = parse(context, marginLeft, declaration.marginLeft);
		            this.opacity = parse(context, opacity, declaration.opacity);
		            var overflowTuple = parse(context, overflow, declaration.overflow);
		            this.overflowX = overflowTuple[0];
		            this.overflowY = overflowTuple[overflowTuple.length > 1 ? 1 : 0];
		            this.overflowWrap = parse(context, overflowWrap, declaration.overflowWrap);
		            this.paddingTop = parse(context, paddingTop, declaration.paddingTop);
		            this.paddingRight = parse(context, paddingRight, declaration.paddingRight);
		            this.paddingBottom = parse(context, paddingBottom, declaration.paddingBottom);
		            this.paddingLeft = parse(context, paddingLeft, declaration.paddingLeft);
		            this.paintOrder = parse(context, paintOrder, declaration.paintOrder);
		            this.position = parse(context, position, declaration.position);
		            this.textAlign = parse(context, textAlign, declaration.textAlign);
		            this.textDecorationColor = parse(context, textDecorationColor, (_a = declaration.textDecorationColor) !== null && _a !== void 0 ? _a : declaration.color);
		            this.textDecorationLine = parse(context, textDecorationLine, (_b = declaration.textDecorationLine) !== null && _b !== void 0 ? _b : declaration.textDecoration);
		            this.textShadow = parse(context, textShadow, declaration.textShadow);
		            this.textTransform = parse(context, textTransform, declaration.textTransform);
		            this.transform = parse(context, transform$1, declaration.transform);
		            this.transformOrigin = parse(context, transformOrigin, declaration.transformOrigin);
		            this.visibility = parse(context, visibility, declaration.visibility);
		            this.webkitTextStrokeColor = parse(context, webkitTextStrokeColor, declaration.webkitTextStrokeColor);
		            this.webkitTextStrokeWidth = parse(context, webkitTextStrokeWidth, declaration.webkitTextStrokeWidth);
		            this.wordBreak = parse(context, wordBreak, declaration.wordBreak);
		            this.zIndex = parse(context, zIndex, declaration.zIndex);
		        }
		        CSSParsedDeclaration.prototype.isVisible = function () {
		            return this.display > 0 && this.opacity > 0 && this.visibility === 0 /* VISIBLE */;
		        };
		        CSSParsedDeclaration.prototype.isTransparent = function () {
		            return isTransparent(this.backgroundColor);
		        };
		        CSSParsedDeclaration.prototype.isTransformed = function () {
		            return this.transform !== null;
		        };
		        CSSParsedDeclaration.prototype.isPositioned = function () {
		            return this.position !== 0 /* STATIC */;
		        };
		        CSSParsedDeclaration.prototype.isPositionedWithZIndex = function () {
		            return this.isPositioned() && !this.zIndex.auto;
		        };
		        CSSParsedDeclaration.prototype.isFloating = function () {
		            return this.float !== 0 /* NONE */;
		        };
		        CSSParsedDeclaration.prototype.isInlineLevel = function () {
		            return (contains(this.display, 4 /* INLINE */) ||
		                contains(this.display, 33554432 /* INLINE_BLOCK */) ||
		                contains(this.display, 268435456 /* INLINE_FLEX */) ||
		                contains(this.display, 536870912 /* INLINE_GRID */) ||
		                contains(this.display, 67108864 /* INLINE_LIST_ITEM */) ||
		                contains(this.display, 134217728 /* INLINE_TABLE */));
		        };
		        return CSSParsedDeclaration;
		    }());
		    var CSSParsedPseudoDeclaration = /** @class */ (function () {
		        function CSSParsedPseudoDeclaration(context, declaration) {
		            this.content = parse(context, content, declaration.content);
		            this.quotes = parse(context, quotes, declaration.quotes);
		        }
		        return CSSParsedPseudoDeclaration;
		    }());
		    var CSSParsedCounterDeclaration = /** @class */ (function () {
		        function CSSParsedCounterDeclaration(context, declaration) {
		            this.counterIncrement = parse(context, counterIncrement, declaration.counterIncrement);
		            this.counterReset = parse(context, counterReset, declaration.counterReset);
		        }
		        return CSSParsedCounterDeclaration;
		    }());
		    // eslint-disable-next-line @typescript-eslint/no-explicit-any
		    var parse = function (context, descriptor, style) {
		        var tokenizer = new Tokenizer();
		        var value = style !== null && typeof style !== 'undefined' ? style.toString() : descriptor.initialValue;
		        tokenizer.write(value);
		        var parser = new Parser(tokenizer.read());
		        switch (descriptor.type) {
		            case 2 /* IDENT_VALUE */:
		                var token = parser.parseComponentValue();
		                return descriptor.parse(context, isIdentToken(token) ? token.value : descriptor.initialValue);
		            case 0 /* VALUE */:
		                return descriptor.parse(context, parser.parseComponentValue());
		            case 1 /* LIST */:
		                return descriptor.parse(context, parser.parseComponentValues());
		            case 4 /* TOKEN_VALUE */:
		                return parser.parseComponentValue();
		            case 3 /* TYPE_VALUE */:
		                switch (descriptor.format) {
		                    case 'angle':
		                        return angle.parse(context, parser.parseComponentValue());
		                    case 'color':
		                        return color$1.parse(context, parser.parseComponentValue());
		                    case 'image':
		                        return image.parse(context, parser.parseComponentValue());
		                    case 'length':
		                        var length_1 = parser.parseComponentValue();
		                        return isLength(length_1) ? length_1 : ZERO_LENGTH;
		                    case 'length-percentage':
		                        var value_1 = parser.parseComponentValue();
		                        return isLengthPercentage(value_1) ? value_1 : ZERO_LENGTH;
		                    case 'time':
		                        return time.parse(context, parser.parseComponentValue());
		                }
		                break;
		        }
		    };

		    var elementDebuggerAttribute = 'data-html2canvas-debug';
		    var getElementDebugType = function (element) {
		        var attribute = element.getAttribute(elementDebuggerAttribute);
		        switch (attribute) {
		            case 'all':
		                return 1 /* ALL */;
		            case 'clone':
		                return 2 /* CLONE */;
		            case 'parse':
		                return 3 /* PARSE */;
		            case 'render':
		                return 4 /* RENDER */;
		            default:
		                return 0 /* NONE */;
		        }
		    };
		    var isDebugging = function (element, type) {
		        var elementType = getElementDebugType(element);
		        return elementType === 1 /* ALL */ || type === elementType;
		    };

		    var ElementContainer = /** @class */ (function () {
		        function ElementContainer(context, element) {
		            this.context = context;
		            this.textNodes = [];
		            this.elements = [];
		            this.flags = 0;
		            if (isDebugging(element, 3 /* PARSE */)) {
		                debugger;
		            }
		            this.styles = new CSSParsedDeclaration(context, window.getComputedStyle(element, null));
		            if (isHTMLElementNode(element)) {
		                if (this.styles.animationDuration.some(function (duration) { return duration > 0; })) {
		                    element.style.animationDuration = '0s';
		                }
		                if (this.styles.transform !== null) {
		                    // getBoundingClientRect takes transforms into account
		                    element.style.transform = 'none';
		                }
		            }
		            this.bounds = parseBounds(this.context, element);
		            if (isDebugging(element, 4 /* RENDER */)) {
		                this.flags |= 16 /* DEBUG_RENDER */;
		            }
		        }
		        return ElementContainer;
		    }());

		    /*
		     * text-segmentation 1.0.3 <https://github.com/niklasvh/text-segmentation>
		     * Copyright (c) 2022 Niklas von Hertzen <https://hertzen.com>
		     * Released under MIT License
		     */
		    var base64 = 'AAAAAAAAAAAAEA4AGBkAAFAaAAACAAAAAAAIABAAGAAwADgACAAQAAgAEAAIABAACAAQAAgAEAAIABAACAAQAAgAEAAIABAAQABIAEQATAAIABAACAAQAAgAEAAIABAAVABcAAgAEAAIABAACAAQAGAAaABwAHgAgACIAI4AlgAIABAAmwCjAKgAsAC2AL4AvQDFAMoA0gBPAVYBWgEIAAgACACMANoAYgFkAWwBdAF8AX0BhQGNAZUBlgGeAaMBlQGWAasBswF8AbsBwwF0AcsBYwHTAQgA2wG/AOMBdAF8AekB8QF0AfkB+wHiAHQBfAEIAAMC5gQIAAsCEgIIAAgAFgIeAggAIgIpAggAMQI5AkACygEIAAgASAJQAlgCYAIIAAgACAAKBQoFCgUTBRMFGQUrBSsFCAAIAAgACAAIAAgACAAIAAgACABdAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACABoAmgCrwGvAQgAbgJ2AggAHgEIAAgACADnAXsCCAAIAAgAgwIIAAgACAAIAAgACACKAggAkQKZAggAPADJAAgAoQKkAqwCsgK6AsICCADJAggA0AIIAAgACAAIANYC3gIIAAgACAAIAAgACABAAOYCCAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAkASoB+QIEAAgACAA8AEMCCABCBQgACABJBVAFCAAIAAgACAAIAAgACAAIAAgACABTBVoFCAAIAFoFCABfBWUFCAAIAAgACAAIAAgAbQUIAAgACAAIAAgACABzBXsFfQWFBYoFigWKBZEFigWKBYoFmAWfBaYFrgWxBbkFCAAIAAgACAAIAAgACAAIAAgACAAIAMEFCAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAMgFCADQBQgACAAIAAgACAAIAAgACAAIAAgACAAIAO4CCAAIAAgAiQAIAAgACABAAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAD0AggACAD8AggACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIANYFCAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAMDvwAIAAgAJAIIAAgACAAIAAgACAAIAAgACwMTAwgACAB9BOsEGwMjAwgAKwMyAwsFYgE3A/MEPwMIAEUDTQNRAwgAWQOsAGEDCAAIAAgACAAIAAgACABpAzQFNQU2BTcFOAU5BToFNAU1BTYFNwU4BTkFOgU0BTUFNgU3BTgFOQU6BTQFNQU2BTcFOAU5BToFNAU1BTYFNwU4BTkFOgU0BTUFNgU3BTgFOQU6BTQFNQU2BTcFOAU5BToFNAU1BTYFNwU4BTkFOgU0BTUFNgU3BTgFOQU6BTQFNQU2BTcFOAU5BToFNAU1BTYFNwU4BTkFOgU0BTUFNgU3BTgFOQU6BTQFNQU2BTcFOAU5BToFNAU1BTYFNwU4BTkFOgU0BTUFNgU3BTgFOQU6BTQFNQU2BTcFOAU5BToFNAU1BTYFNwU4BTkFOgU0BTUFNgU3BTgFOQU6BTQFNQU2BTcFOAU5BToFNAU1BTYFNwU4BTkFOgU0BTUFNgU3BTgFOQU6BTQFNQU2BTcFOAU5BToFNAU1BTYFNwU4BTkFOgU0BTUFNgU3BTgFOQU6BTQFNQU2BTcFOAU5BToFNAU1BTYFNwU4BTkFOgU0BTUFNgU3BTgFOQU6BTQFNQU2BTcFOAU5BToFNAU1BTYFNwU4BTkFOgU0BTUFNgU3BTgFOQU6BTQFNQU2BTcFOAU5BToFNAU1BTYFNwU4BTkFOgU0BTUFNgU3BTgFOQU6BTQFNQU2BTcFOAU5BToFNAU1BTYFNwU4BTkFOgU0BTUFNgU3BTgFOQU6BTQFNQU2BTcFOAU5BToFNAU1BTYFNwU4BTkFOgU0BTUFNgU3BTgFOQU6BTQFNQU2BTcFOAU5BToFNAU1BTYFNwU4BTkFOgU0BTUFNgU3BTgFOQU6BTQFNQU2BTcFOAU5BToFNAU1BTYFNwU4BTkFOgU0BTUFNgU3BTgFOQU6BTQFNQU2BTcFOAU5BToFNAU1BTYFNwU4BTkFOgU0BTUFNgU3BTgFOQU6BTQFNQU2BTcFOAU5BToFNAU1BTYFNwU4BTkFIQUoBSwFCAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACABtAwgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACABMAEwACAAIAAgACAAIABgACAAIAAgACAC/AAgACAAyAQgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACACAAIAAwAAgACAAIAAgACAAIAAgACAAIAAAARABIAAgACAAIABQASAAIAAgAIABwAEAAjgCIABsAqAC2AL0AigDQAtwC+IJIQqVAZUBWQqVAZUBlQGVAZUBlQGrC5UBlQGVAZUBlQGVAZUBlQGVAXsKlQGVAbAK6wsrDGUMpQzlDJUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAZUBlQGVAfAKAAuZA64AtwCJALoC6ADwAAgAuACgA/oEpgO6AqsD+AAIAAgAswMIAAgACAAIAIkAuwP5AfsBwwPLAwgACAAIAAgACADRA9kDCAAIAOED6QMIAAgACAAIAAgACADuA/YDCAAIAP4DyQAIAAgABgQIAAgAXQAOBAgACAAIAAgACAAIABMECAAIAAgACAAIAAgACAD8AAQBCAAIAAgAGgQiBCoECAExBAgAEAEIAAgACAAIAAgACAAIAAgACAAIAAgACAA4BAgACABABEYECAAIAAgATAQYAQgAVAQIAAgACAAIAAgACAAIAAgACAAIAFoECAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgAOQEIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAB+BAcACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAEABhgSMBAgACAAIAAgAlAQIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAwAEAAQABAADAAMAAwADAAQABAAEAAQABAAEAAQABHATAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgAdQMIAAgACAAIAAgACAAIAMkACAAIAAgAfQMIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACACFA4kDCAAIAAgACAAIAOcBCAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAIcDCAAIAAgACAAIAAgACAAIAAgACAAIAJEDCAAIAAgACADFAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACABgBAgAZgQIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgAbAQCBXIECAAIAHkECAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACABAAJwEQACjBKoEsgQIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAC6BMIECAAIAAgACAAIAAgACABmBAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgAxwQIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAGYECAAIAAgAzgQIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgAigWKBYoFigWKBYoFigWKBd0FXwUIAOIF6gXxBYoF3gT5BQAGCAaKBYoFigWKBYoFigWKBYoFigWKBYoFigXWBIoFigWKBYoFigWKBYoFigWKBYsFEAaKBYoFigWKBYoFigWKBRQGCACKBYoFigWKBQgACAAIANEECAAIABgGigUgBggAJgYIAC4GMwaKBYoF0wQ3Bj4GigWKBYoFigWKBYoFigWKBYoFigWKBYoFigUIAAgACAAIAAgACAAIAAgAigWKBYoFigWKBYoFigWKBYoFigWKBYoFigWKBYoFigWKBYoFigWKBYoFigWKBYoFigWKBYoFigWKBYoFigWLBf///////wQABAAEAAQABAAEAAQABAAEAAQAAwAEAAQAAgAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAAAAAAAAAAAAAAAAAAAAAAAAAOAAAAAAAAAAQADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUABQAFAAUABQAFAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAAAAUAAAAFAAUAAAAFAAUAAAAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAEAAQABAAEAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAUABQAFAAUABQAFAAUABQAFAAUABQAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUABQAFAAUABQAFAAUAAQAAAAUABQAFAAUABQAFAAAAAAAFAAUAAAAFAAUABQAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAUABQAFAAUABQAFAAUABQAFAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAUABQAFAAUABQAFAAUABQAAAAAAAAAAAAAAAAAAAAAAAAAFAAAAAAAFAAUAAQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABwAFAAUABQAFAAAABwAHAAcAAAAHAAcABwAFAAEAAAAAAAAAAAAAAAAAAAAAAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHAAcABwAFAAUABQAFAAcABwAFAAUAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHAAAAAQABAAAAAAAAAAAAAAAFAAUABQAFAAAABwAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAHAAcABwAHAAcAAAAHAAcAAAAAAAUABQAHAAUAAQAHAAEABwAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAFAAUABQAFAAUABwABAAUABQAFAAUAAAAAAAAAAAAAAAEAAQABAAEAAQABAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABwAFAAUAAAAAAAAAAAAAAAAABQAFAAUABQAFAAUAAQAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUABQAFAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQABQANAAQABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQABAAEAAQABAAEAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAEAAQABAAEAAQABAAEAAQABAAEAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAQABAAEAAQABAAEAAQABAAAAAAAAAAAAAAAAAAAAAAABQAHAAUABQAFAAAAAAAAAAcABQAFAAUABQAFAAQABAAEAAQABAAEAAQABAAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUABQAFAAUAAAAFAAUABQAFAAUAAAAFAAUABQAAAAUABQAFAAUABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAUABQAAAAAAAAAAAAUABQAFAAcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAHAAUAAAAHAAcABwAFAAUABQAFAAUABQAFAAUABwAHAAcABwAFAAcABwAAAAUABQAFAAUABQAFAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUABwAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAAAAUABwAHAAUABQAFAAUAAAAAAAcABwAAAAAABwAHAAUAAAAAAAAAAAAAAAAAAAAAAAAABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAUABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAAAAAABQAFAAcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAAABwAHAAcABQAFAAAAAAAAAAAABQAFAAAAAAAFAAUABQAAAAAAAAAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUABQAAAAAAAAAFAAAAAAAAAAAAAAAAAAAAAAAAAAAABwAFAAUABQAFAAUAAAAFAAUABwAAAAcABwAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAUABQAFAAUABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUAAAAFAAUABwAFAAUABQAFAAAAAAAHAAcAAAAAAAcABwAFAAAAAAAAAAAAAAAAAAAABQAFAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAcABwAAAAAAAAAHAAcABwAAAAcABwAHAAUAAAAAAAAAAAAAAAAAAAAAAAAABQAAAAAAAAAAAAAAAAAAAAAABQAHAAcABwAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUABwAHAAcABwAAAAUABQAFAAAABQAFAAUABQAAAAAAAAAAAAAAAAAAAAUABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAAAAcABQAHAAcABQAHAAcAAAAFAAcABwAAAAcABwAFAAUAAAAAAAAAAAAAAAAAAAAFAAUAAAAAAAAAAAAAAAAAAAAAAAAABQAFAAcABwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUABQAAAAUABwAAAAAAAAAAAAAAAAAAAAAAAAAAAAUAAAAAAAAAAAAFAAcABwAFAAUABQAAAAUAAAAHAAcABwAHAAcABwAHAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUAAAAHAAUABQAFAAUABQAFAAUAAAAAAAAAAAAAAAAAAAAAAAUABQAFAAUABQAFAAUABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAAABwAFAAUABQAFAAUABQAFAAUABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAFAAUABQAFAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAAAAUAAAAFAAAAAAAAAAAABwAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABwAFAAUABQAFAAUAAAAFAAUAAAAAAAAAAAAAAAUABQAFAAUABQAFAAUABQAFAAUABQAAAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUABQAFAAUABwAFAAUABQAFAAUABQAAAAUABQAHAAcABQAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHAAcABQAFAAAAAAAAAAAABQAFAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAUABQAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAAAAcABQAFAAAAAAAAAAAAAAAAAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAFAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUABQAHAAUABQAFAAUABQAFAAUABwAHAAcABwAHAAcABwAHAAUABwAHAAUABQAFAAUABQAFAAUABQAFAAUABQAAAAAAAAAAAAAAAAAAAAAAAAAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAFAAUABwAHAAcABwAFAAUABwAHAAcAAAAAAAAAAAAHAAcABQAHAAcABwAHAAcABwAFAAUABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAFAAcABwAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcABQAHAAUABQAFAAUABQAFAAUAAAAFAAAABQAAAAAABQAFAAUABQAFAAUABQAFAAcABwAHAAcABwAHAAUABQAFAAUABQAFAAUABQAFAAUAAAAAAAUABQAFAAUABQAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUABQAFAAUABQAFAAUABwAFAAcABwAHAAcABwAFAAcABwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAUABQAFAAUABQAFAAUABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAUABwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHAAUABQAFAAUABwAHAAUABQAHAAUABQAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAcABQAFAAcABwAHAAUABwAFAAUABQAHAAcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABwAHAAcABwAHAAcABwAHAAUABQAFAAUABQAFAAUABQAHAAcABQAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAFAAUAAAAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAcABQAFAAUABQAFAAUABQAAAAAAAAAAAAUAAAAAAAAAAAAAAAAABQAAAAAABwAFAAUAAAAAAAAAAAAAAAAABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAAABQAFAAUABQAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUABQAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAFAAUABQAFAAUADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUABQAFAAUAAAAFAAUABQAFAAUABQAFAAUABQAFAAAAAAAAAAAABQAAAAAAAAAFAAAAAAAAAAAABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABwAHAAUABQAHAAAAAAAAAAAABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcABwAHAAcABQAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUAAAAAAAAAAAAAAAAABQAFAAUABQAFAAUABQAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUABQAFAAUABQAFAAUABQAFAAUABQAHAAcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAcABwAFAAUABQAFAAcABwAFAAUABwAHAAAAAAAAAAAAAAAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUABQAFAAUABQAFAAcABwAFAAUABwAHAAUABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAAAAAAAAAAAAAAAAAAAAAAFAAcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUAAAAFAAUABQAAAAAABQAFAAAAAAAAAAAAAAAFAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcABQAFAAcABwAAAAAAAAAAAAAABwAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcABwAFAAcABwAFAAcABwAAAAcABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUABQAFAAUABQAAAAAAAAAAAAAAAAAFAAUABQAAAAUABQAAAAAAAAAAAAAABQAFAAUABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAUABQAAAAAAAAAAAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcABQAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAUABQAFAAUABwAFAAUABQAFAAUABQAFAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABwAHAAcABQAFAAUABQAFAAUABQAFAAUABwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHAAcABwAFAAUABQAHAAcABQAHAAUABQAAAAAAAAAAAAAAAAAFAAAABwAHAAcABQAFAAUABQAFAAUABQAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUABwAHAAcABwAAAAAABwAHAAAAAAAHAAcABwAAAAAAAAAAAAAAAAAAAAAAAAAFAAAAAAAAAAAAAAAAAAAAAAAAAAAABwAHAAAAAAAFAAUABQAFAAUABQAFAAAAAAAAAAUABQAFAAUABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHAAcABwAFAAUABQAFAAUABQAFAAUABwAHAAUABQAFAAcABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAHAAcABQAFAAUABQAFAAUABwAFAAcABwAFAAcABQAFAAcABQAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAHAAcABQAFAAUABQAAAAAABwAHAAcABwAFAAUABwAFAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcABwAHAAUABQAFAAUABQAFAAUABQAHAAcABQAHAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUABwAFAAcABwAFAAUABQAFAAUABQAHAAUAAAAAAAAAAAAAAAAAAAAAAAcABwAFAAUABQAFAAcABQAFAAUABQAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHAAcABwAFAAUABQAFAAUABQAFAAUABQAHAAUABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHAAcABwAFAAUABQAFAAAAAAAFAAUABwAHAAcABwAFAAAAAAAAAAcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAUABQAFAAUABQAFAAUABQAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUAAAAAAAAAAAAAAAAAAAAAAAAABQAFAAUABQAFAAUABwAHAAUABQAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcABQAFAAUABQAFAAUABQAAAAUABQAFAAUABQAFAAcABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUAAAAHAAUABQAFAAUABQAFAAUABwAFAAUABwAFAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAFAAUABQAFAAUAAAAAAAAABQAAAAUABQAAAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAHAAcABwAHAAcAAAAFAAUAAAAHAAcABQAHAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAUABwAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAUABQAFAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAUABQAFAAUABQAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAAAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAAAAAAAAAAAAAAAAAAABQAFAAUABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcABwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUABQAAAAUABQAFAAAAAAAFAAUABQAFAAUABQAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAFAAUABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAFAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAAAAAAAAAAABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAAAAAAAAAAAAAAAAAAAAAAFAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUABQAFAAUABQAAAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAFAAUABQAFAAUABQAAAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAFAAUABQAAAAAABQAFAAUABQAFAAUABQAAAAUABQAAAAUABQAFAAUABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAUABQAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAFAAUABQAFAAUABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAFAAUABQAFAAUADgAOAA4ADgAOAA4ADwAPAA8ADwAPAA8ADwAPAA8ADwAPAA8ADwAPAA8ADwAPAA8ADwAPAA8ADwAPAA8ADwAPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcABwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABwAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAcABwAHAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAAAAAAAAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAKAAoACgAKAAoACgAKAAoACgAKAAoACgAKAAoACgAKAAoACgAKAAoACgAKAAoACgAMAAwADAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkAAAAAAAAAAAAKAAoACgAKAAoACgAKAAoACgAKAAoACgAKAAoACgAKAAoACgAKAAoACgAKAAoACgAKAAoACgAKAAoACgAKAAoACgAAAAAAAAAAAAsADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwACwAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAAAAAADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAA4ADgAOAA4ADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4ADgAAAAAAAAAAAAAAAAAAAAAADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgAOAA4ADgAOAA4ADgAOAA4ADgAOAAAAAAAAAAAADgAOAA4AAAAAAAAAAAAAAAAAAAAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgAOAAAAAAAAAAAAAAAAAAAAAAAAAAAADgAAAAAAAAAAAAAAAAAAAAAAAAAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgAOAA4ADgAAAA4ADgAOAA4ADgAOAAAADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4AAAAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAAAAAAAAAAAAAAAAAAAAAAAAAAAADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4AAAAAAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAAAA4AAAAOAAAAAAAAAAAAAAAAAA4AAAAAAAAAAAAAAAAADgAAAAAAAAAAAAAAAAAAAAAAAAAAAA4ADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgAAAAAADgAAAAAAAAAAAA4AAAAOAAAAAAAAAAAADgAOAA4AAAAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAA4ADgAOAA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAA4ADgAAAAAAAAAAAAAAAAAAAAAAAAAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4ADgAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgAAAAAAAAAAAA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAAAADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAA4ADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4ADgAOAA4ADgAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4ADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgAAAAAADgAOAA4ADgAOAA4ADgAOAA4ADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAAAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAAAAAAAAAAAAAAAAAAAAAAAAAAAADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4AAAAAAA4ADgAOAA4ADgAOAA4ADgAOAAAADgAOAA4ADgAAAAAAAAAAAAAAAAAAAAAAAAAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4AAAAAAAAAAAAAAAAADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAA4ADgAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgAOAA4ADgAOAA4ADgAOAAAAAAAAAAAAAAAAAAAAAAAAAAAADgAOAA4ADgAOAA4AAAAAAAAAAAAAAAAAAAAAAA4ADgAOAA4ADgAOAA4ADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4AAAAOAA4ADgAOAA4ADgAAAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4AAAAAAAAAAAA=';

		    /*
		     * utrie 1.0.2 <https://github.com/niklasvh/utrie>
		     * Copyright (c) 2022 Niklas von Hertzen <https://hertzen.com>
		     * Released under MIT License
		     */
		    var chars$1 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
		    // Use a lookup table to find the index.
		    var lookup$1 = typeof Uint8Array === 'undefined' ? [] : new Uint8Array(256);
		    for (var i$1 = 0; i$1 < chars$1.length; i$1++) {
		        lookup$1[chars$1.charCodeAt(i$1)] = i$1;
		    }
		    var decode = function (base64) {
		        var bufferLength = base64.length * 0.75, len = base64.length, i, p = 0, encoded1, encoded2, encoded3, encoded4;
		        if (base64[base64.length - 1] === '=') {
		            bufferLength--;
		            if (base64[base64.length - 2] === '=') {
		                bufferLength--;
		            }
		        }
		        var buffer = typeof ArrayBuffer !== 'undefined' &&
		            typeof Uint8Array !== 'undefined' &&
		            typeof Uint8Array.prototype.slice !== 'undefined'
		            ? new ArrayBuffer(bufferLength)
		            : new Array(bufferLength);
		        var bytes = Array.isArray(buffer) ? buffer : new Uint8Array(buffer);
		        for (i = 0; i < len; i += 4) {
		            encoded1 = lookup$1[base64.charCodeAt(i)];
		            encoded2 = lookup$1[base64.charCodeAt(i + 1)];
		            encoded3 = lookup$1[base64.charCodeAt(i + 2)];
		            encoded4 = lookup$1[base64.charCodeAt(i + 3)];
		            bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
		            bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
		            bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
		        }
		        return buffer;
		    };
		    var polyUint16Array = function (buffer) {
		        var length = buffer.length;
		        var bytes = [];
		        for (var i = 0; i < length; i += 2) {
		            bytes.push((buffer[i + 1] << 8) | buffer[i]);
		        }
		        return bytes;
		    };
		    var polyUint32Array = function (buffer) {
		        var length = buffer.length;
		        var bytes = [];
		        for (var i = 0; i < length; i += 4) {
		            bytes.push((buffer[i + 3] << 24) | (buffer[i + 2] << 16) | (buffer[i + 1] << 8) | buffer[i]);
		        }
		        return bytes;
		    };

		    /** Shift size for getting the index-2 table offset. */
		    var UTRIE2_SHIFT_2 = 5;
		    /** Shift size for getting the index-1 table offset. */
		    var UTRIE2_SHIFT_1 = 6 + 5;
		    /**
		     * Shift size for shifting left the index array values.
		     * Increases possible data size with 16-bit index values at the cost
		     * of compactability.
		     * This requires data blocks to be aligned by UTRIE2_DATA_GRANULARITY.
		     */
		    var UTRIE2_INDEX_SHIFT = 2;
		    /**
		     * Difference between the two shift sizes,
		     * for getting an index-1 offset from an index-2 offset. 6=11-5
		     */
		    var UTRIE2_SHIFT_1_2 = UTRIE2_SHIFT_1 - UTRIE2_SHIFT_2;
		    /**
		     * The part of the index-2 table for U+D800..U+DBFF stores values for
		     * lead surrogate code _units_ not code _points_.
		     * Values for lead surrogate code _points_ are indexed with this portion of the table.
		     * Length=32=0x20=0x400>>UTRIE2_SHIFT_2. (There are 1024=0x400 lead surrogates.)
		     */
		    var UTRIE2_LSCP_INDEX_2_OFFSET = 0x10000 >> UTRIE2_SHIFT_2;
		    /** Number of entries in a data block. 32=0x20 */
		    var UTRIE2_DATA_BLOCK_LENGTH = 1 << UTRIE2_SHIFT_2;
		    /** Mask for getting the lower bits for the in-data-block offset. */
		    var UTRIE2_DATA_MASK = UTRIE2_DATA_BLOCK_LENGTH - 1;
		    var UTRIE2_LSCP_INDEX_2_LENGTH = 0x400 >> UTRIE2_SHIFT_2;
		    /** Count the lengths of both BMP pieces. 2080=0x820 */
		    var UTRIE2_INDEX_2_BMP_LENGTH = UTRIE2_LSCP_INDEX_2_OFFSET + UTRIE2_LSCP_INDEX_2_LENGTH;
		    /**
		     * The 2-byte UTF-8 version of the index-2 table follows at offset 2080=0x820.
		     * Length 32=0x20 for lead bytes C0..DF, regardless of UTRIE2_SHIFT_2.
		     */
		    var UTRIE2_UTF8_2B_INDEX_2_OFFSET = UTRIE2_INDEX_2_BMP_LENGTH;
		    var UTRIE2_UTF8_2B_INDEX_2_LENGTH = 0x800 >> 6; /* U+0800 is the first code point after 2-byte UTF-8 */
		    /**
		     * The index-1 table, only used for supplementary code points, at offset 2112=0x840.
		     * Variable length, for code points up to highStart, where the last single-value range starts.
		     * Maximum length 512=0x200=0x100000>>UTRIE2_SHIFT_1.
		     * (For 0x100000 supplementary code points U+10000..U+10ffff.)
		     *
		     * The part of the index-2 table for supplementary code points starts
		     * after this index-1 table.
		     *
		     * Both the index-1 table and the following part of the index-2 table
		     * are omitted completely if there is only BMP data.
		     */
		    var UTRIE2_INDEX_1_OFFSET = UTRIE2_UTF8_2B_INDEX_2_OFFSET + UTRIE2_UTF8_2B_INDEX_2_LENGTH;
		    /**
		     * Number of index-1 entries for the BMP. 32=0x20
		     * This part of the index-1 table is omitted from the serialized form.
		     */
		    var UTRIE2_OMITTED_BMP_INDEX_1_LENGTH = 0x10000 >> UTRIE2_SHIFT_1;
		    /** Number of entries in an index-2 block. 64=0x40 */
		    var UTRIE2_INDEX_2_BLOCK_LENGTH = 1 << UTRIE2_SHIFT_1_2;
		    /** Mask for getting the lower bits for the in-index-2-block offset. */
		    var UTRIE2_INDEX_2_MASK = UTRIE2_INDEX_2_BLOCK_LENGTH - 1;
		    var slice16 = function (view, start, end) {
		        if (view.slice) {
		            return view.slice(start, end);
		        }
		        return new Uint16Array(Array.prototype.slice.call(view, start, end));
		    };
		    var slice32 = function (view, start, end) {
		        if (view.slice) {
		            return view.slice(start, end);
		        }
		        return new Uint32Array(Array.prototype.slice.call(view, start, end));
		    };
		    var createTrieFromBase64 = function (base64, _byteLength) {
		        var buffer = decode(base64);
		        var view32 = Array.isArray(buffer) ? polyUint32Array(buffer) : new Uint32Array(buffer);
		        var view16 = Array.isArray(buffer) ? polyUint16Array(buffer) : new Uint16Array(buffer);
		        var headerLength = 24;
		        var index = slice16(view16, headerLength / 2, view32[4] / 2);
		        var data = view32[5] === 2
		            ? slice16(view16, (headerLength + view32[4]) / 2)
		            : slice32(view32, Math.ceil((headerLength + view32[4]) / 4));
		        return new Trie(view32[0], view32[1], view32[2], view32[3], index, data);
		    };
		    var Trie = /** @class */ (function () {
		        function Trie(initialValue, errorValue, highStart, highValueIndex, index, data) {
		            this.initialValue = initialValue;
		            this.errorValue = errorValue;
		            this.highStart = highStart;
		            this.highValueIndex = highValueIndex;
		            this.index = index;
		            this.data = data;
		        }
		        /**
		         * Get the value for a code point as stored in the Trie.
		         *
		         * @param codePoint the code point
		         * @return the value
		         */
		        Trie.prototype.get = function (codePoint) {
		            var ix;
		            if (codePoint >= 0) {
		                if (codePoint < 0x0d800 || (codePoint > 0x0dbff && codePoint <= 0x0ffff)) {
		                    // Ordinary BMP code point, excluding leading surrogates.
		                    // BMP uses a single level lookup.  BMP index starts at offset 0 in the Trie2 index.
		                    // 16 bit data is stored in the index array itself.
		                    ix = this.index[codePoint >> UTRIE2_SHIFT_2];
		                    ix = (ix << UTRIE2_INDEX_SHIFT) + (codePoint & UTRIE2_DATA_MASK);
		                    return this.data[ix];
		                }
		                if (codePoint <= 0xffff) {
		                    // Lead Surrogate Code Point.  A Separate index section is stored for
		                    // lead surrogate code units and code points.
		                    //   The main index has the code unit data.
		                    //   For this function, we need the code point data.
		                    // Note: this expression could be refactored for slightly improved efficiency, but
		                    //       surrogate code points will be so rare in practice that it's not worth it.
		                    ix = this.index[UTRIE2_LSCP_INDEX_2_OFFSET + ((codePoint - 0xd800) >> UTRIE2_SHIFT_2)];
		                    ix = (ix << UTRIE2_INDEX_SHIFT) + (codePoint & UTRIE2_DATA_MASK);
		                    return this.data[ix];
		                }
		                if (codePoint < this.highStart) {
		                    // Supplemental code point, use two-level lookup.
		                    ix = UTRIE2_INDEX_1_OFFSET - UTRIE2_OMITTED_BMP_INDEX_1_LENGTH + (codePoint >> UTRIE2_SHIFT_1);
		                    ix = this.index[ix];
		                    ix += (codePoint >> UTRIE2_SHIFT_2) & UTRIE2_INDEX_2_MASK;
		                    ix = this.index[ix];
		                    ix = (ix << UTRIE2_INDEX_SHIFT) + (codePoint & UTRIE2_DATA_MASK);
		                    return this.data[ix];
		                }
		                if (codePoint <= 0x10ffff) {
		                    return this.data[this.highValueIndex];
		                }
		            }
		            // Fall through.  The code point is outside of the legal range of 0..0x10ffff.
		            return this.errorValue;
		        };
		        return Trie;
		    }());

		    /*
		     * base64-arraybuffer 1.0.2 <https://github.com/niklasvh/base64-arraybuffer>
		     * Copyright (c) 2022 Niklas von Hertzen <https://hertzen.com>
		     * Released under MIT License
		     */
		    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
		    // Use a lookup table to find the index.
		    var lookup = typeof Uint8Array === 'undefined' ? [] : new Uint8Array(256);
		    for (var i = 0; i < chars.length; i++) {
		        lookup[chars.charCodeAt(i)] = i;
		    }

		    var Prepend = 1;
		    var CR = 2;
		    var LF = 3;
		    var Control = 4;
		    var Extend = 5;
		    var SpacingMark = 7;
		    var L = 8;
		    var V = 9;
		    var T = 10;
		    var LV = 11;
		    var LVT = 12;
		    var ZWJ = 13;
		    var Extended_Pictographic = 14;
		    var RI = 15;
		    var toCodePoints = function (str) {
		        var codePoints = [];
		        var i = 0;
		        var length = str.length;
		        while (i < length) {
		            var value = str.charCodeAt(i++);
		            if (value >= 0xd800 && value <= 0xdbff && i < length) {
		                var extra = str.charCodeAt(i++);
		                if ((extra & 0xfc00) === 0xdc00) {
		                    codePoints.push(((value & 0x3ff) << 10) + (extra & 0x3ff) + 0x10000);
		                }
		                else {
		                    codePoints.push(value);
		                    i--;
		                }
		            }
		            else {
		                codePoints.push(value);
		            }
		        }
		        return codePoints;
		    };
		    var fromCodePoint = function () {
		        var codePoints = [];
		        for (var _i = 0; _i < arguments.length; _i++) {
		            codePoints[_i] = arguments[_i];
		        }
		        if (String.fromCodePoint) {
		            return String.fromCodePoint.apply(String, codePoints);
		        }
		        var length = codePoints.length;
		        if (!length) {
		            return '';
		        }
		        var codeUnits = [];
		        var index = -1;
		        var result = '';
		        while (++index < length) {
		            var codePoint = codePoints[index];
		            if (codePoint <= 0xffff) {
		                codeUnits.push(codePoint);
		            }
		            else {
		                codePoint -= 0x10000;
		                codeUnits.push((codePoint >> 10) + 0xd800, (codePoint % 0x400) + 0xdc00);
		            }
		            if (index + 1 === length || codeUnits.length > 0x4000) {
		                result += String.fromCharCode.apply(String, codeUnits);
		                codeUnits.length = 0;
		            }
		        }
		        return result;
		    };
		    var UnicodeTrie = createTrieFromBase64(base64);
		    var BREAK_NOT_ALLOWED = '×';
		    var BREAK_ALLOWED = '÷';
		    var codePointToClass = function (codePoint) { return UnicodeTrie.get(codePoint); };
		    var _graphemeBreakAtIndex = function (_codePoints, classTypes, index) {
		        var prevIndex = index - 2;
		        var prev = classTypes[prevIndex];
		        var current = classTypes[index - 1];
		        var next = classTypes[index];
		        // GB3 Do not break between a CR and LF
		        if (current === CR && next === LF) {
		            return BREAK_NOT_ALLOWED;
		        }
		        // GB4 Otherwise, break before and after controls.
		        if (current === CR || current === LF || current === Control) {
		            return BREAK_ALLOWED;
		        }
		        // GB5
		        if (next === CR || next === LF || next === Control) {
		            return BREAK_ALLOWED;
		        }
		        // Do not break Hangul syllable sequences.
		        // GB6
		        if (current === L && [L, V, LV, LVT].indexOf(next) !== -1) {
		            return BREAK_NOT_ALLOWED;
		        }
		        // GB7
		        if ((current === LV || current === V) && (next === V || next === T)) {
		            return BREAK_NOT_ALLOWED;
		        }
		        // GB8
		        if ((current === LVT || current === T) && next === T) {
		            return BREAK_NOT_ALLOWED;
		        }
		        // GB9 Do not break before extending characters or ZWJ.
		        if (next === ZWJ || next === Extend) {
		            return BREAK_NOT_ALLOWED;
		        }
		        // Do not break before SpacingMarks, or after Prepend characters.
		        // GB9a
		        if (next === SpacingMark) {
		            return BREAK_NOT_ALLOWED;
		        }
		        // GB9a
		        if (current === Prepend) {
		            return BREAK_NOT_ALLOWED;
		        }
		        // GB11 Do not break within emoji modifier sequences or emoji zwj sequences.
		        if (current === ZWJ && next === Extended_Pictographic) {
		            while (prev === Extend) {
		                prev = classTypes[--prevIndex];
		            }
		            if (prev === Extended_Pictographic) {
		                return BREAK_NOT_ALLOWED;
		            }
		        }
		        // GB12 Do not break within emoji flag sequences.
		        // That is, do not break between regional indicator (RI) symbols
		        // if there is an odd number of RI characters before the break point.
		        if (current === RI && next === RI) {
		            var countRI = 0;
		            while (prev === RI) {
		                countRI++;
		                prev = classTypes[--prevIndex];
		            }
		            if (countRI % 2 === 0) {
		                return BREAK_NOT_ALLOWED;
		            }
		        }
		        return BREAK_ALLOWED;
		    };
		    var GraphemeBreaker = function (str) {
		        var codePoints = toCodePoints(str);
		        var length = codePoints.length;
		        var index = 0;
		        var lastEnd = 0;
		        var classTypes = codePoints.map(codePointToClass);
		        return {
		            next: function () {
		                if (index >= length) {
		                    return { done: true, value: null };
		                }
		                var graphemeBreak = BREAK_NOT_ALLOWED;
		                while (index < length &&
		                    (graphemeBreak = _graphemeBreakAtIndex(codePoints, classTypes, ++index)) === BREAK_NOT_ALLOWED) { }
		                if (graphemeBreak !== BREAK_NOT_ALLOWED || index === length) {
		                    var value = fromCodePoint.apply(null, codePoints.slice(lastEnd, index));
		                    lastEnd = index;
		                    return { value: value, done: false };
		                }
		                return { done: true, value: null };
		            },
		        };
		    };
		    var splitGraphemes = function (str) {
		        var breaker = GraphemeBreaker(str);
		        var graphemes = [];
		        var bk;
		        while (!(bk = breaker.next()).done) {
		            if (bk.value) {
		                graphemes.push(bk.value.slice());
		            }
		        }
		        return graphemes;
		    };

		    var testRangeBounds = function (document) {
		        var TEST_HEIGHT = 123;
		        if (document.createRange) {
		            var range = document.createRange();
		            if (range.getBoundingClientRect) {
		                var testElement = document.createElement('boundtest');
		                testElement.style.height = TEST_HEIGHT + "px";
		                testElement.style.display = 'block';
		                document.body.appendChild(testElement);
		                range.selectNode(testElement);
		                var rangeBounds = range.getBoundingClientRect();
		                var rangeHeight = Math.round(rangeBounds.height);
		                document.body.removeChild(testElement);
		                if (rangeHeight === TEST_HEIGHT) {
		                    return true;
		                }
		            }
		        }
		        return false;
		    };
		    var testIOSLineBreak = function (document) {
		        var testElement = document.createElement('boundtest');
		        testElement.style.width = '50px';
		        testElement.style.display = 'block';
		        testElement.style.fontSize = '12px';
		        testElement.style.letterSpacing = '0px';
		        testElement.style.wordSpacing = '0px';
		        document.body.appendChild(testElement);
		        var range = document.createRange();
		        testElement.innerHTML = typeof ''.repeat === 'function' ? '&#128104;'.repeat(10) : '';
		        var node = testElement.firstChild;
		        var textList = toCodePoints$1(node.data).map(function (i) { return fromCodePoint$1(i); });
		        var offset = 0;
		        var prev = {};
		        // ios 13 does not handle range getBoundingClientRect line changes correctly #2177
		        var supports = textList.every(function (text, i) {
		            range.setStart(node, offset);
		            range.setEnd(node, offset + text.length);
		            var rect = range.getBoundingClientRect();
		            offset += text.length;
		            var boundAhead = rect.x > prev.x || rect.y > prev.y;
		            prev = rect;
		            if (i === 0) {
		                return true;
		            }
		            return boundAhead;
		        });
		        document.body.removeChild(testElement);
		        return supports;
		    };
		    var testCORS = function () { return typeof new Image().crossOrigin !== 'undefined'; };
		    var testResponseType = function () { return typeof new XMLHttpRequest().responseType === 'string'; };
		    var testSVG = function (document) {
		        var img = new Image();
		        var canvas = document.createElement('canvas');
		        var ctx = canvas.getContext('2d');
		        if (!ctx) {
		            return false;
		        }
		        img.src = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'></svg>";
		        try {
		            ctx.drawImage(img, 0, 0);
		            canvas.toDataURL();
		        }
		        catch (e) {
		            return false;
		        }
		        return true;
		    };
		    var isGreenPixel = function (data) {
		        return data[0] === 0 && data[1] === 255 && data[2] === 0 && data[3] === 255;
		    };
		    var testForeignObject = function (document) {
		        var canvas = document.createElement('canvas');
		        var size = 100;
		        canvas.width = size;
		        canvas.height = size;
		        var ctx = canvas.getContext('2d');
		        if (!ctx) {
		            return Promise.reject(false);
		        }
		        ctx.fillStyle = 'rgb(0, 255, 0)';
		        ctx.fillRect(0, 0, size, size);
		        var img = new Image();
		        var greenImageSrc = canvas.toDataURL();
		        img.src = greenImageSrc;
		        var svg = createForeignObjectSVG(size, size, 0, 0, img);
		        ctx.fillStyle = 'red';
		        ctx.fillRect(0, 0, size, size);
		        return loadSerializedSVG$1(svg)
		            .then(function (img) {
		            ctx.drawImage(img, 0, 0);
		            var data = ctx.getImageData(0, 0, size, size).data;
		            ctx.fillStyle = 'red';
		            ctx.fillRect(0, 0, size, size);
		            var node = document.createElement('div');
		            node.style.backgroundImage = "url(" + greenImageSrc + ")";
		            node.style.height = size + "px";
		            // Firefox 55 does not render inline <img /> tags
		            return isGreenPixel(data)
		                ? loadSerializedSVG$1(createForeignObjectSVG(size, size, 0, 0, node))
		                : Promise.reject(false);
		        })
		            .then(function (img) {
		            ctx.drawImage(img, 0, 0);
		            // Edge does not render background-images
		            return isGreenPixel(ctx.getImageData(0, 0, size, size).data);
		        })
		            .catch(function () { return false; });
		    };
		    var createForeignObjectSVG = function (width, height, x, y, node) {
		        var xmlns = 'http://www.w3.org/2000/svg';
		        var svg = document.createElementNS(xmlns, 'svg');
		        var foreignObject = document.createElementNS(xmlns, 'foreignObject');
		        svg.setAttributeNS(null, 'width', width.toString());
		        svg.setAttributeNS(null, 'height', height.toString());
		        foreignObject.setAttributeNS(null, 'width', '100%');
		        foreignObject.setAttributeNS(null, 'height', '100%');
		        foreignObject.setAttributeNS(null, 'x', x.toString());
		        foreignObject.setAttributeNS(null, 'y', y.toString());
		        foreignObject.setAttributeNS(null, 'externalResourcesRequired', 'true');
		        svg.appendChild(foreignObject);
		        foreignObject.appendChild(node);
		        return svg;
		    };
		    var loadSerializedSVG$1 = function (svg) {
		        return new Promise(function (resolve, reject) {
		            var img = new Image();
		            img.onload = function () { return resolve(img); };
		            img.onerror = reject;
		            img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg));
		        });
		    };
		    var FEATURES = {
		        get SUPPORT_RANGE_BOUNDS() {
		            var value = testRangeBounds(document);
		            Object.defineProperty(FEATURES, 'SUPPORT_RANGE_BOUNDS', { value: value });
		            return value;
		        },
		        get SUPPORT_WORD_BREAKING() {
		            var value = FEATURES.SUPPORT_RANGE_BOUNDS && testIOSLineBreak(document);
		            Object.defineProperty(FEATURES, 'SUPPORT_WORD_BREAKING', { value: value });
		            return value;
		        },
		        get SUPPORT_SVG_DRAWING() {
		            var value = testSVG(document);
		            Object.defineProperty(FEATURES, 'SUPPORT_SVG_DRAWING', { value: value });
		            return value;
		        },
		        get SUPPORT_FOREIGNOBJECT_DRAWING() {
		            var value = typeof Array.from === 'function' && typeof window.fetch === 'function'
		                ? testForeignObject(document)
		                : Promise.resolve(false);
		            Object.defineProperty(FEATURES, 'SUPPORT_FOREIGNOBJECT_DRAWING', { value: value });
		            return value;
		        },
		        get SUPPORT_CORS_IMAGES() {
		            var value = testCORS();
		            Object.defineProperty(FEATURES, 'SUPPORT_CORS_IMAGES', { value: value });
		            return value;
		        },
		        get SUPPORT_RESPONSE_TYPE() {
		            var value = testResponseType();
		            Object.defineProperty(FEATURES, 'SUPPORT_RESPONSE_TYPE', { value: value });
		            return value;
		        },
		        get SUPPORT_CORS_XHR() {
		            var value = 'withCredentials' in new XMLHttpRequest();
		            Object.defineProperty(FEATURES, 'SUPPORT_CORS_XHR', { value: value });
		            return value;
		        },
		        get SUPPORT_NATIVE_TEXT_SEGMENTATION() {
		            // eslint-disable-next-line @typescript-eslint/no-explicit-any
		            var value = !!(typeof Intl !== 'undefined' && Intl.Segmenter);
		            Object.defineProperty(FEATURES, 'SUPPORT_NATIVE_TEXT_SEGMENTATION', { value: value });
		            return value;
		        }
		    };

		    var TextBounds = /** @class */ (function () {
		        function TextBounds(text, bounds) {
		            this.text = text;
		            this.bounds = bounds;
		        }
		        return TextBounds;
		    }());
		    var parseTextBounds = function (context, value, styles, node) {
		        var textList = breakText(value, styles);
		        var textBounds = [];
		        var offset = 0;
		        textList.forEach(function (text) {
		            if (styles.textDecorationLine.length || text.trim().length > 0) {
		                if (FEATURES.SUPPORT_RANGE_BOUNDS) {
		                    var clientRects = createRange(node, offset, text.length).getClientRects();
		                    if (clientRects.length > 1) {
		                        var subSegments = segmentGraphemes(text);
		                        var subOffset_1 = 0;
		                        subSegments.forEach(function (subSegment) {
		                            textBounds.push(new TextBounds(subSegment, Bounds.fromDOMRectList(context, createRange(node, subOffset_1 + offset, subSegment.length).getClientRects())));
		                            subOffset_1 += subSegment.length;
		                        });
		                    }
		                    else {
		                        textBounds.push(new TextBounds(text, Bounds.fromDOMRectList(context, clientRects)));
		                    }
		                }
		                else {
		                    var replacementNode = node.splitText(text.length);
		                    textBounds.push(new TextBounds(text, getWrapperBounds(context, node)));
		                    node = replacementNode;
		                }
		            }
		            else if (!FEATURES.SUPPORT_RANGE_BOUNDS) {
		                node = node.splitText(text.length);
		            }
		            offset += text.length;
		        });
		        return textBounds;
		    };
		    var getWrapperBounds = function (context, node) {
		        var ownerDocument = node.ownerDocument;
		        if (ownerDocument) {
		            var wrapper = ownerDocument.createElement('html2canvaswrapper');
		            wrapper.appendChild(node.cloneNode(true));
		            var parentNode = node.parentNode;
		            if (parentNode) {
		                parentNode.replaceChild(wrapper, node);
		                var bounds = parseBounds(context, wrapper);
		                if (wrapper.firstChild) {
		                    parentNode.replaceChild(wrapper.firstChild, wrapper);
		                }
		                return bounds;
		            }
		        }
		        return Bounds.EMPTY;
		    };
		    var createRange = function (node, offset, length) {
		        var ownerDocument = node.ownerDocument;
		        if (!ownerDocument) {
		            throw new Error('Node has no owner document');
		        }
		        var range = ownerDocument.createRange();
		        range.setStart(node, offset);
		        range.setEnd(node, offset + length);
		        return range;
		    };
		    var segmentGraphemes = function (value) {
		        if (FEATURES.SUPPORT_NATIVE_TEXT_SEGMENTATION) {
		            // eslint-disable-next-line @typescript-eslint/no-explicit-any
		            var segmenter = new Intl.Segmenter(void 0, { granularity: 'grapheme' });
		            // eslint-disable-next-line @typescript-eslint/no-explicit-any
		            return Array.from(segmenter.segment(value)).map(function (segment) { return segment.segment; });
		        }
		        return splitGraphemes(value);
		    };
		    var segmentWords = function (value, styles) {
		        if (FEATURES.SUPPORT_NATIVE_TEXT_SEGMENTATION) {
		            // eslint-disable-next-line @typescript-eslint/no-explicit-any
		            var segmenter = new Intl.Segmenter(void 0, {
		                granularity: 'word'
		            });
		            // eslint-disable-next-line @typescript-eslint/no-explicit-any
		            return Array.from(segmenter.segment(value)).map(function (segment) { return segment.segment; });
		        }
		        return breakWords(value, styles);
		    };
		    var breakText = function (value, styles) {
		        return styles.letterSpacing !== 0 ? segmentGraphemes(value) : segmentWords(value, styles);
		    };
		    // https://drafts.csswg.org/css-text/#word-separator
		    var wordSeparators = [0x0020, 0x00a0, 0x1361, 0x10100, 0x10101, 0x1039, 0x1091];
		    var breakWords = function (str, styles) {
		        var breaker = LineBreaker(str, {
		            lineBreak: styles.lineBreak,
		            wordBreak: styles.overflowWrap === "break-word" /* BREAK_WORD */ ? 'break-word' : styles.wordBreak
		        });
		        var words = [];
		        var bk;
		        var _loop_1 = function () {
		            if (bk.value) {
		                var value = bk.value.slice();
		                var codePoints = toCodePoints$1(value);
		                var word_1 = '';
		                codePoints.forEach(function (codePoint) {
		                    if (wordSeparators.indexOf(codePoint) === -1) {
		                        word_1 += fromCodePoint$1(codePoint);
		                    }
		                    else {
		                        if (word_1.length) {
		                            words.push(word_1);
		                        }
		                        words.push(fromCodePoint$1(codePoint));
		                        word_1 = '';
		                    }
		                });
		                if (word_1.length) {
		                    words.push(word_1);
		                }
		            }
		        };
		        while (!(bk = breaker.next()).done) {
		            _loop_1();
		        }
		        return words;
		    };

		    var TextContainer = /** @class */ (function () {
		        function TextContainer(context, node, styles) {
		            this.text = transform(node.data, styles.textTransform);
		            this.textBounds = parseTextBounds(context, this.text, styles, node);
		        }
		        return TextContainer;
		    }());
		    var transform = function (text, transform) {
		        switch (transform) {
		            case 1 /* LOWERCASE */:
		                return text.toLowerCase();
		            case 3 /* CAPITALIZE */:
		                return text.replace(CAPITALIZE, capitalize);
		            case 2 /* UPPERCASE */:
		                return text.toUpperCase();
		            default:
		                return text;
		        }
		    };
		    var CAPITALIZE = /(^|\s|:|-|\(|\))([a-z])/g;
		    var capitalize = function (m, p1, p2) {
		        if (m.length > 0) {
		            return p1 + p2.toUpperCase();
		        }
		        return m;
		    };

		    var ImageElementContainer = /** @class */ (function (_super) {
		        __extends(ImageElementContainer, _super);
		        function ImageElementContainer(context, img) {
		            var _this = _super.call(this, context, img) || this;
		            _this.src = img.currentSrc || img.src;
		            _this.intrinsicWidth = img.naturalWidth;
		            _this.intrinsicHeight = img.naturalHeight;
		            _this.context.cache.addImage(_this.src);
		            return _this;
		        }
		        return ImageElementContainer;
		    }(ElementContainer));

		    var CanvasElementContainer = /** @class */ (function (_super) {
		        __extends(CanvasElementContainer, _super);
		        function CanvasElementContainer(context, canvas) {
		            var _this = _super.call(this, context, canvas) || this;
		            _this.canvas = canvas;
		            _this.intrinsicWidth = canvas.width;
		            _this.intrinsicHeight = canvas.height;
		            return _this;
		        }
		        return CanvasElementContainer;
		    }(ElementContainer));

		    var SVGElementContainer = /** @class */ (function (_super) {
		        __extends(SVGElementContainer, _super);
		        function SVGElementContainer(context, img) {
		            var _this = _super.call(this, context, img) || this;
		            var s = new XMLSerializer();
		            var bounds = parseBounds(context, img);
		            img.setAttribute('width', bounds.width + "px");
		            img.setAttribute('height', bounds.height + "px");
		            _this.svg = "data:image/svg+xml," + encodeURIComponent(s.serializeToString(img));
		            _this.intrinsicWidth = img.width.baseVal.value;
		            _this.intrinsicHeight = img.height.baseVal.value;
		            _this.context.cache.addImage(_this.svg);
		            return _this;
		        }
		        return SVGElementContainer;
		    }(ElementContainer));

		    var LIElementContainer = /** @class */ (function (_super) {
		        __extends(LIElementContainer, _super);
		        function LIElementContainer(context, element) {
		            var _this = _super.call(this, context, element) || this;
		            _this.value = element.value;
		            return _this;
		        }
		        return LIElementContainer;
		    }(ElementContainer));

		    var OLElementContainer = /** @class */ (function (_super) {
		        __extends(OLElementContainer, _super);
		        function OLElementContainer(context, element) {
		            var _this = _super.call(this, context, element) || this;
		            _this.start = element.start;
		            _this.reversed = typeof element.reversed === 'boolean' && element.reversed === true;
		            return _this;
		        }
		        return OLElementContainer;
		    }(ElementContainer));

		    var CHECKBOX_BORDER_RADIUS = [
		        {
		            type: 15 /* DIMENSION_TOKEN */,
		            flags: 0,
		            unit: 'px',
		            number: 3
		        }
		    ];
		    var RADIO_BORDER_RADIUS = [
		        {
		            type: 16 /* PERCENTAGE_TOKEN */,
		            flags: 0,
		            number: 50
		        }
		    ];
		    var reformatInputBounds = function (bounds) {
		        if (bounds.width > bounds.height) {
		            return new Bounds(bounds.left + (bounds.width - bounds.height) / 2, bounds.top, bounds.height, bounds.height);
		        }
		        else if (bounds.width < bounds.height) {
		            return new Bounds(bounds.left, bounds.top + (bounds.height - bounds.width) / 2, bounds.width, bounds.width);
		        }
		        return bounds;
		    };
		    var getInputValue = function (node) {
		        var value = node.type === PASSWORD ? new Array(node.value.length + 1).join('\u2022') : node.value;
		        return value.length === 0 ? node.placeholder || '' : value;
		    };
		    var CHECKBOX = 'checkbox';
		    var RADIO = 'radio';
		    var PASSWORD = 'password';
		    var INPUT_COLOR = 0x2a2a2aff;
		    var InputElementContainer = /** @class */ (function (_super) {
		        __extends(InputElementContainer, _super);
		        function InputElementContainer(context, input) {
		            var _this = _super.call(this, context, input) || this;
		            _this.type = input.type.toLowerCase();
		            _this.checked = input.checked;
		            _this.value = getInputValue(input);
		            if (_this.type === CHECKBOX || _this.type === RADIO) {
		                _this.styles.backgroundColor = 0xdededeff;
		                _this.styles.borderTopColor =
		                    _this.styles.borderRightColor =
		                        _this.styles.borderBottomColor =
		                            _this.styles.borderLeftColor =
		                                0xa5a5a5ff;
		                _this.styles.borderTopWidth =
		                    _this.styles.borderRightWidth =
		                        _this.styles.borderBottomWidth =
		                            _this.styles.borderLeftWidth =
		                                1;
		                _this.styles.borderTopStyle =
		                    _this.styles.borderRightStyle =
		                        _this.styles.borderBottomStyle =
		                            _this.styles.borderLeftStyle =
		                                1 /* SOLID */;
		                _this.styles.backgroundClip = [0 /* BORDER_BOX */];
		                _this.styles.backgroundOrigin = [0 /* BORDER_BOX */];
		                _this.bounds = reformatInputBounds(_this.bounds);
		            }
		            switch (_this.type) {
		                case CHECKBOX:
		                    _this.styles.borderTopRightRadius =
		                        _this.styles.borderTopLeftRadius =
		                            _this.styles.borderBottomRightRadius =
		                                _this.styles.borderBottomLeftRadius =
		                                    CHECKBOX_BORDER_RADIUS;
		                    break;
		                case RADIO:
		                    _this.styles.borderTopRightRadius =
		                        _this.styles.borderTopLeftRadius =
		                            _this.styles.borderBottomRightRadius =
		                                _this.styles.borderBottomLeftRadius =
		                                    RADIO_BORDER_RADIUS;
		                    break;
		            }
		            return _this;
		        }
		        return InputElementContainer;
		    }(ElementContainer));

		    var SelectElementContainer = /** @class */ (function (_super) {
		        __extends(SelectElementContainer, _super);
		        function SelectElementContainer(context, element) {
		            var _this = _super.call(this, context, element) || this;
		            var option = element.options[element.selectedIndex || 0];
		            _this.value = option ? option.text || '' : '';
		            return _this;
		        }
		        return SelectElementContainer;
		    }(ElementContainer));

		    var TextareaElementContainer = /** @class */ (function (_super) {
		        __extends(TextareaElementContainer, _super);
		        function TextareaElementContainer(context, element) {
		            var _this = _super.call(this, context, element) || this;
		            _this.value = element.value;
		            return _this;
		        }
		        return TextareaElementContainer;
		    }(ElementContainer));

		    var IFrameElementContainer = /** @class */ (function (_super) {
		        __extends(IFrameElementContainer, _super);
		        function IFrameElementContainer(context, iframe) {
		            var _this = _super.call(this, context, iframe) || this;
		            _this.src = iframe.src;
		            _this.width = parseInt(iframe.width, 10) || 0;
		            _this.height = parseInt(iframe.height, 10) || 0;
		            _this.backgroundColor = _this.styles.backgroundColor;
		            try {
		                if (iframe.contentWindow &&
		                    iframe.contentWindow.document &&
		                    iframe.contentWindow.document.documentElement) {
		                    _this.tree = parseTree(context, iframe.contentWindow.document.documentElement);
		                    // http://www.w3.org/TR/css3-background/#special-backgrounds
		                    var documentBackgroundColor = iframe.contentWindow.document.documentElement
		                        ? parseColor(context, getComputedStyle(iframe.contentWindow.document.documentElement).backgroundColor)
		                        : COLORS.TRANSPARENT;
		                    var bodyBackgroundColor = iframe.contentWindow.document.body
		                        ? parseColor(context, getComputedStyle(iframe.contentWindow.document.body).backgroundColor)
		                        : COLORS.TRANSPARENT;
		                    _this.backgroundColor = isTransparent(documentBackgroundColor)
		                        ? isTransparent(bodyBackgroundColor)
		                            ? _this.styles.backgroundColor
		                            : bodyBackgroundColor
		                        : documentBackgroundColor;
		                }
		            }
		            catch (e) { }
		            return _this;
		        }
		        return IFrameElementContainer;
		    }(ElementContainer));

		    var LIST_OWNERS = ['OL', 'UL', 'MENU'];
		    var parseNodeTree = function (context, node, parent, root) {
		        for (var childNode = node.firstChild, nextNode = void 0; childNode; childNode = nextNode) {
		            nextNode = childNode.nextSibling;
		            if (isTextNode(childNode) && childNode.data.trim().length > 0) {
		                parent.textNodes.push(new TextContainer(context, childNode, parent.styles));
		            }
		            else if (isElementNode(childNode)) {
		                if (isSlotElement(childNode) && childNode.assignedNodes) {
		                    childNode.assignedNodes().forEach(function (childNode) { return parseNodeTree(context, childNode, parent, root); });
		                }
		                else {
		                    var container = createContainer(context, childNode);
		                    if (container.styles.isVisible()) {
		                        if (createsRealStackingContext(childNode, container, root)) {
		                            container.flags |= 4 /* CREATES_REAL_STACKING_CONTEXT */;
		                        }
		                        else if (createsStackingContext(container.styles)) {
		                            container.flags |= 2 /* CREATES_STACKING_CONTEXT */;
		                        }
		                        if (LIST_OWNERS.indexOf(childNode.tagName) !== -1) {
		                            container.flags |= 8 /* IS_LIST_OWNER */;
		                        }
		                        parent.elements.push(container);
		                        childNode.slot;
		                        if (childNode.shadowRoot) {
		                            parseNodeTree(context, childNode.shadowRoot, container, root);
		                        }
		                        else if (!isTextareaElement(childNode) &&
		                            !isSVGElement(childNode) &&
		                            !isSelectElement(childNode)) {
		                            parseNodeTree(context, childNode, container, root);
		                        }
		                    }
		                }
		            }
		        }
		    };
		    var createContainer = function (context, element) {
		        if (isImageElement(element)) {
		            return new ImageElementContainer(context, element);
		        }
		        if (isCanvasElement(element)) {
		            return new CanvasElementContainer(context, element);
		        }
		        if (isSVGElement(element)) {
		            return new SVGElementContainer(context, element);
		        }
		        if (isLIElement(element)) {
		            return new LIElementContainer(context, element);
		        }
		        if (isOLElement(element)) {
		            return new OLElementContainer(context, element);
		        }
		        if (isInputElement(element)) {
		            return new InputElementContainer(context, element);
		        }
		        if (isSelectElement(element)) {
		            return new SelectElementContainer(context, element);
		        }
		        if (isTextareaElement(element)) {
		            return new TextareaElementContainer(context, element);
		        }
		        if (isIFrameElement(element)) {
		            return new IFrameElementContainer(context, element);
		        }
		        return new ElementContainer(context, element);
		    };
		    var parseTree = function (context, element) {
		        var container = createContainer(context, element);
		        container.flags |= 4 /* CREATES_REAL_STACKING_CONTEXT */;
		        parseNodeTree(context, element, container, container);
		        return container;
		    };
		    var createsRealStackingContext = function (node, container, root) {
		        return (container.styles.isPositionedWithZIndex() ||
		            container.styles.opacity < 1 ||
		            container.styles.isTransformed() ||
		            (isBodyElement(node) && root.styles.isTransparent()));
		    };
		    var createsStackingContext = function (styles) { return styles.isPositioned() || styles.isFloating(); };
		    var isTextNode = function (node) { return node.nodeType === Node.TEXT_NODE; };
		    var isElementNode = function (node) { return node.nodeType === Node.ELEMENT_NODE; };
		    var isHTMLElementNode = function (node) {
		        return isElementNode(node) && typeof node.style !== 'undefined' && !isSVGElementNode(node);
		    };
		    var isSVGElementNode = function (element) {
		        return typeof element.className === 'object';
		    };
		    var isLIElement = function (node) { return node.tagName === 'LI'; };
		    var isOLElement = function (node) { return node.tagName === 'OL'; };
		    var isInputElement = function (node) { return node.tagName === 'INPUT'; };
		    var isHTMLElement = function (node) { return node.tagName === 'HTML'; };
		    var isSVGElement = function (node) { return node.tagName === 'svg'; };
		    var isBodyElement = function (node) { return node.tagName === 'BODY'; };
		    var isCanvasElement = function (node) { return node.tagName === 'CANVAS'; };
		    var isVideoElement = function (node) { return node.tagName === 'VIDEO'; };
		    var isImageElement = function (node) { return node.tagName === 'IMG'; };
		    var isIFrameElement = function (node) { return node.tagName === 'IFRAME'; };
		    var isStyleElement = function (node) { return node.tagName === 'STYLE'; };
		    var isScriptElement = function (node) { return node.tagName === 'SCRIPT'; };
		    var isTextareaElement = function (node) { return node.tagName === 'TEXTAREA'; };
		    var isSelectElement = function (node) { return node.tagName === 'SELECT'; };
		    var isSlotElement = function (node) { return node.tagName === 'SLOT'; };
		    // https://html.spec.whatwg.org/multipage/custom-elements.html#valid-custom-element-name
		    var isCustomElement = function (node) { return node.tagName.indexOf('-') > 0; };

		    var CounterState = /** @class */ (function () {
		        function CounterState() {
		            this.counters = {};
		        }
		        CounterState.prototype.getCounterValue = function (name) {
		            var counter = this.counters[name];
		            if (counter && counter.length) {
		                return counter[counter.length - 1];
		            }
		            return 1;
		        };
		        CounterState.prototype.getCounterValues = function (name) {
		            var counter = this.counters[name];
		            return counter ? counter : [];
		        };
		        CounterState.prototype.pop = function (counters) {
		            var _this = this;
		            counters.forEach(function (counter) { return _this.counters[counter].pop(); });
		        };
		        CounterState.prototype.parse = function (style) {
		            var _this = this;
		            var counterIncrement = style.counterIncrement;
		            var counterReset = style.counterReset;
		            var canReset = true;
		            if (counterIncrement !== null) {
		                counterIncrement.forEach(function (entry) {
		                    var counter = _this.counters[entry.counter];
		                    if (counter && entry.increment !== 0) {
		                        canReset = false;
		                        if (!counter.length) {
		                            counter.push(1);
		                        }
		                        counter[Math.max(0, counter.length - 1)] += entry.increment;
		                    }
		                });
		            }
		            var counterNames = [];
		            if (canReset) {
		                counterReset.forEach(function (entry) {
		                    var counter = _this.counters[entry.counter];
		                    counterNames.push(entry.counter);
		                    if (!counter) {
		                        counter = _this.counters[entry.counter] = [];
		                    }
		                    counter.push(entry.reset);
		                });
		            }
		            return counterNames;
		        };
		        return CounterState;
		    }());
		    var ROMAN_UPPER = {
		        integers: [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1],
		        values: ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I']
		    };
		    var ARMENIAN = {
		        integers: [
		            9000, 8000, 7000, 6000, 5000, 4000, 3000, 2000, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100, 90, 80, 70,
		            60, 50, 40, 30, 20, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1
		        ],
		        values: [
		            'Ք',
		            'Փ',
		            'Ւ',
		            'Ց',
		            'Ր',
		            'Տ',
		            'Վ',
		            'Ս',
		            'Ռ',
		            'Ջ',
		            'Պ',
		            'Չ',
		            'Ո',
		            'Շ',
		            'Ն',
		            'Յ',
		            'Մ',
		            'Ճ',
		            'Ղ',
		            'Ձ',
		            'Հ',
		            'Կ',
		            'Ծ',
		            'Խ',
		            'Լ',
		            'Ի',
		            'Ժ',
		            'Թ',
		            'Ը',
		            'Է',
		            'Զ',
		            'Ե',
		            'Դ',
		            'Գ',
		            'Բ',
		            'Ա'
		        ]
		    };
		    var HEBREW = {
		        integers: [
		            10000, 9000, 8000, 7000, 6000, 5000, 4000, 3000, 2000, 1000, 400, 300, 200, 100, 90, 80, 70, 60, 50, 40, 30, 20,
		            19, 18, 17, 16, 15, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1
		        ],
		        values: [
		            'י׳',
		            'ט׳',
		            'ח׳',
		            'ז׳',
		            'ו׳',
		            'ה׳',
		            'ד׳',
		            'ג׳',
		            'ב׳',
		            'א׳',
		            'ת',
		            'ש',
		            'ר',
		            'ק',
		            'צ',
		            'פ',
		            'ע',
		            'ס',
		            'נ',
		            'מ',
		            'ל',
		            'כ',
		            'יט',
		            'יח',
		            'יז',
		            'טז',
		            'טו',
		            'י',
		            'ט',
		            'ח',
		            'ז',
		            'ו',
		            'ה',
		            'ד',
		            'ג',
		            'ב',
		            'א'
		        ]
		    };
		    var GEORGIAN = {
		        integers: [
		            10000, 9000, 8000, 7000, 6000, 5000, 4000, 3000, 2000, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100, 90,
		            80, 70, 60, 50, 40, 30, 20, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1
		        ],
		        values: [
		            'ჵ',
		            'ჰ',
		            'ჯ',
		            'ჴ',
		            'ხ',
		            'ჭ',
		            'წ',
		            'ძ',
		            'ც',
		            'ჩ',
		            'შ',
		            'ყ',
		            'ღ',
		            'ქ',
		            'ფ',
		            'ჳ',
		            'ტ',
		            'ს',
		            'რ',
		            'ჟ',
		            'პ',
		            'ო',
		            'ჲ',
		            'ნ',
		            'მ',
		            'ლ',
		            'კ',
		            'ი',
		            'თ',
		            'ჱ',
		            'ზ',
		            'ვ',
		            'ე',
		            'დ',
		            'გ',
		            'ბ',
		            'ა'
		        ]
		    };
		    var createAdditiveCounter = function (value, min, max, symbols, fallback, suffix) {
		        if (value < min || value > max) {
		            return createCounterText(value, fallback, suffix.length > 0);
		        }
		        return (symbols.integers.reduce(function (string, integer, index) {
		            while (value >= integer) {
		                value -= integer;
		                string += symbols.values[index];
		            }
		            return string;
		        }, '') + suffix);
		    };
		    var createCounterStyleWithSymbolResolver = function (value, codePointRangeLength, isNumeric, resolver) {
		        var string = '';
		        do {
		            if (!isNumeric) {
		                value--;
		            }
		            string = resolver(value) + string;
		            value /= codePointRangeLength;
		        } while (value * codePointRangeLength >= codePointRangeLength);
		        return string;
		    };
		    var createCounterStyleFromRange = function (value, codePointRangeStart, codePointRangeEnd, isNumeric, suffix) {
		        var codePointRangeLength = codePointRangeEnd - codePointRangeStart + 1;
		        return ((value < 0 ? '-' : '') +
		            (createCounterStyleWithSymbolResolver(Math.abs(value), codePointRangeLength, isNumeric, function (codePoint) {
		                return fromCodePoint$1(Math.floor(codePoint % codePointRangeLength) + codePointRangeStart);
		            }) +
		                suffix));
		    };
		    var createCounterStyleFromSymbols = function (value, symbols, suffix) {
		        if (suffix === void 0) { suffix = '. '; }
		        var codePointRangeLength = symbols.length;
		        return (createCounterStyleWithSymbolResolver(Math.abs(value), codePointRangeLength, false, function (codePoint) { return symbols[Math.floor(codePoint % codePointRangeLength)]; }) + suffix);
		    };
		    var CJK_ZEROS = 1 << 0;
		    var CJK_TEN_COEFFICIENTS = 1 << 1;
		    var CJK_TEN_HIGH_COEFFICIENTS = 1 << 2;
		    var CJK_HUNDRED_COEFFICIENTS = 1 << 3;
		    var createCJKCounter = function (value, numbers, multipliers, negativeSign, suffix, flags) {
		        if (value < -9999 || value > 9999) {
		            return createCounterText(value, 4 /* CJK_DECIMAL */, suffix.length > 0);
		        }
		        var tmp = Math.abs(value);
		        var string = suffix;
		        if (tmp === 0) {
		            return numbers[0] + string;
		        }
		        for (var digit = 0; tmp > 0 && digit <= 4; digit++) {
		            var coefficient = tmp % 10;
		            if (coefficient === 0 && contains(flags, CJK_ZEROS) && string !== '') {
		                string = numbers[coefficient] + string;
		            }
		            else if (coefficient > 1 ||
		                (coefficient === 1 && digit === 0) ||
		                (coefficient === 1 && digit === 1 && contains(flags, CJK_TEN_COEFFICIENTS)) ||
		                (coefficient === 1 && digit === 1 && contains(flags, CJK_TEN_HIGH_COEFFICIENTS) && value > 100) ||
		                (coefficient === 1 && digit > 1 && contains(flags, CJK_HUNDRED_COEFFICIENTS))) {
		                string = numbers[coefficient] + (digit > 0 ? multipliers[digit - 1] : '') + string;
		            }
		            else if (coefficient === 1 && digit > 0) {
		                string = multipliers[digit - 1] + string;
		            }
		            tmp = Math.floor(tmp / 10);
		        }
		        return (value < 0 ? negativeSign : '') + string;
		    };
		    var CHINESE_INFORMAL_MULTIPLIERS = '十百千萬';
		    var CHINESE_FORMAL_MULTIPLIERS = '拾佰仟萬';
		    var JAPANESE_NEGATIVE = 'マイナス';
		    var KOREAN_NEGATIVE = '마이너스';
		    var createCounterText = function (value, type, appendSuffix) {
		        var defaultSuffix = appendSuffix ? '. ' : '';
		        var cjkSuffix = appendSuffix ? '、' : '';
		        var koreanSuffix = appendSuffix ? ', ' : '';
		        var spaceSuffix = appendSuffix ? ' ' : '';
		        switch (type) {
		            case 0 /* DISC */:
		                return '•' + spaceSuffix;
		            case 1 /* CIRCLE */:
		                return '◦' + spaceSuffix;
		            case 2 /* SQUARE */:
		                return '◾' + spaceSuffix;
		            case 5 /* DECIMAL_LEADING_ZERO */:
		                var string = createCounterStyleFromRange(value, 48, 57, true, defaultSuffix);
		                return string.length < 4 ? "0" + string : string;
		            case 4 /* CJK_DECIMAL */:
		                return createCounterStyleFromSymbols(value, '〇一二三四五六七八九', cjkSuffix);
		            case 6 /* LOWER_ROMAN */:
		                return createAdditiveCounter(value, 1, 3999, ROMAN_UPPER, 3 /* DECIMAL */, defaultSuffix).toLowerCase();
		            case 7 /* UPPER_ROMAN */:
		                return createAdditiveCounter(value, 1, 3999, ROMAN_UPPER, 3 /* DECIMAL */, defaultSuffix);
		            case 8 /* LOWER_GREEK */:
		                return createCounterStyleFromRange(value, 945, 969, false, defaultSuffix);
		            case 9 /* LOWER_ALPHA */:
		                return createCounterStyleFromRange(value, 97, 122, false, defaultSuffix);
		            case 10 /* UPPER_ALPHA */:
		                return createCounterStyleFromRange(value, 65, 90, false, defaultSuffix);
		            case 11 /* ARABIC_INDIC */:
		                return createCounterStyleFromRange(value, 1632, 1641, true, defaultSuffix);
		            case 12 /* ARMENIAN */:
		            case 49 /* UPPER_ARMENIAN */:
		                return createAdditiveCounter(value, 1, 9999, ARMENIAN, 3 /* DECIMAL */, defaultSuffix);
		            case 35 /* LOWER_ARMENIAN */:
		                return createAdditiveCounter(value, 1, 9999, ARMENIAN, 3 /* DECIMAL */, defaultSuffix).toLowerCase();
		            case 13 /* BENGALI */:
		                return createCounterStyleFromRange(value, 2534, 2543, true, defaultSuffix);
		            case 14 /* CAMBODIAN */:
		            case 30 /* KHMER */:
		                return createCounterStyleFromRange(value, 6112, 6121, true, defaultSuffix);
		            case 15 /* CJK_EARTHLY_BRANCH */:
		                return createCounterStyleFromSymbols(value, '子丑寅卯辰巳午未申酉戌亥', cjkSuffix);
		            case 16 /* CJK_HEAVENLY_STEM */:
		                return createCounterStyleFromSymbols(value, '甲乙丙丁戊己庚辛壬癸', cjkSuffix);
		            case 17 /* CJK_IDEOGRAPHIC */:
		            case 48 /* TRAD_CHINESE_INFORMAL */:
		                return createCJKCounter(value, '零一二三四五六七八九', CHINESE_INFORMAL_MULTIPLIERS, '負', cjkSuffix, CJK_TEN_COEFFICIENTS | CJK_TEN_HIGH_COEFFICIENTS | CJK_HUNDRED_COEFFICIENTS);
		            case 47 /* TRAD_CHINESE_FORMAL */:
		                return createCJKCounter(value, '零壹貳參肆伍陸柒捌玖', CHINESE_FORMAL_MULTIPLIERS, '負', cjkSuffix, CJK_ZEROS | CJK_TEN_COEFFICIENTS | CJK_TEN_HIGH_COEFFICIENTS | CJK_HUNDRED_COEFFICIENTS);
		            case 42 /* SIMP_CHINESE_INFORMAL */:
		                return createCJKCounter(value, '零一二三四五六七八九', CHINESE_INFORMAL_MULTIPLIERS, '负', cjkSuffix, CJK_TEN_COEFFICIENTS | CJK_TEN_HIGH_COEFFICIENTS | CJK_HUNDRED_COEFFICIENTS);
		            case 41 /* SIMP_CHINESE_FORMAL */:
		                return createCJKCounter(value, '零壹贰叁肆伍陆柒捌玖', CHINESE_FORMAL_MULTIPLIERS, '负', cjkSuffix, CJK_ZEROS | CJK_TEN_COEFFICIENTS | CJK_TEN_HIGH_COEFFICIENTS | CJK_HUNDRED_COEFFICIENTS);
		            case 26 /* JAPANESE_INFORMAL */:
		                return createCJKCounter(value, '〇一二三四五六七八九', '十百千万', JAPANESE_NEGATIVE, cjkSuffix, 0);
		            case 25 /* JAPANESE_FORMAL */:
		                return createCJKCounter(value, '零壱弐参四伍六七八九', '拾百千万', JAPANESE_NEGATIVE, cjkSuffix, CJK_ZEROS | CJK_TEN_COEFFICIENTS | CJK_TEN_HIGH_COEFFICIENTS);
		            case 31 /* KOREAN_HANGUL_FORMAL */:
		                return createCJKCounter(value, '영일이삼사오육칠팔구', '십백천만', KOREAN_NEGATIVE, koreanSuffix, CJK_ZEROS | CJK_TEN_COEFFICIENTS | CJK_TEN_HIGH_COEFFICIENTS);
		            case 33 /* KOREAN_HANJA_INFORMAL */:
		                return createCJKCounter(value, '零一二三四五六七八九', '十百千萬', KOREAN_NEGATIVE, koreanSuffix, 0);
		            case 32 /* KOREAN_HANJA_FORMAL */:
		                return createCJKCounter(value, '零壹貳參四五六七八九', '拾百千', KOREAN_NEGATIVE, koreanSuffix, CJK_ZEROS | CJK_TEN_COEFFICIENTS | CJK_TEN_HIGH_COEFFICIENTS);
		            case 18 /* DEVANAGARI */:
		                return createCounterStyleFromRange(value, 0x966, 0x96f, true, defaultSuffix);
		            case 20 /* GEORGIAN */:
		                return createAdditiveCounter(value, 1, 19999, GEORGIAN, 3 /* DECIMAL */, defaultSuffix);
		            case 21 /* GUJARATI */:
		                return createCounterStyleFromRange(value, 0xae6, 0xaef, true, defaultSuffix);
		            case 22 /* GURMUKHI */:
		                return createCounterStyleFromRange(value, 0xa66, 0xa6f, true, defaultSuffix);
		            case 22 /* HEBREW */:
		                return createAdditiveCounter(value, 1, 10999, HEBREW, 3 /* DECIMAL */, defaultSuffix);
		            case 23 /* HIRAGANA */:
		                return createCounterStyleFromSymbols(value, 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわゐゑをん');
		            case 24 /* HIRAGANA_IROHA */:
		                return createCounterStyleFromSymbols(value, 'いろはにほへとちりぬるをわかよたれそつねならむうゐのおくやまけふこえてあさきゆめみしゑひもせす');
		            case 27 /* KANNADA */:
		                return createCounterStyleFromRange(value, 0xce6, 0xcef, true, defaultSuffix);
		            case 28 /* KATAKANA */:
		                return createCounterStyleFromSymbols(value, 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヰヱヲン', cjkSuffix);
		            case 29 /* KATAKANA_IROHA */:
		                return createCounterStyleFromSymbols(value, 'イロハニホヘトチリヌルヲワカヨタレソツネナラムウヰノオクヤマケフコエテアサキユメミシヱヒモセス', cjkSuffix);
		            case 34 /* LAO */:
		                return createCounterStyleFromRange(value, 0xed0, 0xed9, true, defaultSuffix);
		            case 37 /* MONGOLIAN */:
		                return createCounterStyleFromRange(value, 0x1810, 0x1819, true, defaultSuffix);
		            case 38 /* MYANMAR */:
		                return createCounterStyleFromRange(value, 0x1040, 0x1049, true, defaultSuffix);
		            case 39 /* ORIYA */:
		                return createCounterStyleFromRange(value, 0xb66, 0xb6f, true, defaultSuffix);
		            case 40 /* PERSIAN */:
		                return createCounterStyleFromRange(value, 0x6f0, 0x6f9, true, defaultSuffix);
		            case 43 /* TAMIL */:
		                return createCounterStyleFromRange(value, 0xbe6, 0xbef, true, defaultSuffix);
		            case 44 /* TELUGU */:
		                return createCounterStyleFromRange(value, 0xc66, 0xc6f, true, defaultSuffix);
		            case 45 /* THAI */:
		                return createCounterStyleFromRange(value, 0xe50, 0xe59, true, defaultSuffix);
		            case 46 /* TIBETAN */:
		                return createCounterStyleFromRange(value, 0xf20, 0xf29, true, defaultSuffix);
		            case 3 /* DECIMAL */:
		            default:
		                return createCounterStyleFromRange(value, 48, 57, true, defaultSuffix);
		        }
		    };

		    var IGNORE_ATTRIBUTE = 'data-html2canvas-ignore';
		    var DocumentCloner = /** @class */ (function () {
		        function DocumentCloner(context, element, options) {
		            this.context = context;
		            this.options = options;
		            this.scrolledElements = [];
		            this.referenceElement = element;
		            this.counters = new CounterState();
		            this.quoteDepth = 0;
		            if (!element.ownerDocument) {
		                throw new Error('Cloned element does not have an owner document');
		            }
		            this.documentElement = this.cloneNode(element.ownerDocument.documentElement, false);
		        }
		        DocumentCloner.prototype.toIFrame = function (ownerDocument, windowSize) {
		            var _this = this;
		            var iframe = createIFrameContainer(ownerDocument, windowSize);
		            if (!iframe.contentWindow) {
		                return Promise.reject("Unable to find iframe window");
		            }
		            var scrollX = ownerDocument.defaultView.pageXOffset;
		            var scrollY = ownerDocument.defaultView.pageYOffset;
		            var cloneWindow = iframe.contentWindow;
		            var documentClone = cloneWindow.document;
		            /* Chrome doesn't detect relative background-images assigned in inline <style> sheets when fetched through getComputedStyle
		             if window url is about:blank, we can assign the url to current by writing onto the document
		             */
		            var iframeLoad = iframeLoader(iframe).then(function () { return __awaiter(_this, void 0, void 0, function () {
		                var onclone, referenceElement;
		                return __generator(this, function (_a) {
		                    switch (_a.label) {
		                        case 0:
		                            this.scrolledElements.forEach(restoreNodeScroll);
		                            if (cloneWindow) {
		                                cloneWindow.scrollTo(windowSize.left, windowSize.top);
		                                if (/(iPad|iPhone|iPod)/g.test(navigator.userAgent) &&
		                                    (cloneWindow.scrollY !== windowSize.top || cloneWindow.scrollX !== windowSize.left)) {
		                                    this.context.logger.warn('Unable to restore scroll position for cloned document');
		                                    this.context.windowBounds = this.context.windowBounds.add(cloneWindow.scrollX - windowSize.left, cloneWindow.scrollY - windowSize.top, 0, 0);
		                                }
		                            }
		                            onclone = this.options.onclone;
		                            referenceElement = this.clonedReferenceElement;
		                            if (typeof referenceElement === 'undefined') {
		                                return [2 /*return*/, Promise.reject("Error finding the " + this.referenceElement.nodeName + " in the cloned document")];
		                            }
		                            if (!(documentClone.fonts && documentClone.fonts.ready)) return [3 /*break*/, 2];
		                            return [4 /*yield*/, documentClone.fonts.ready];
		                        case 1:
		                            _a.sent();
		                            _a.label = 2;
		                        case 2:
		                            if (!/(AppleWebKit)/g.test(navigator.userAgent)) return [3 /*break*/, 4];
		                            return [4 /*yield*/, imagesReady(documentClone)];
		                        case 3:
		                            _a.sent();
		                            _a.label = 4;
		                        case 4:
		                            if (typeof onclone === 'function') {
		                                return [2 /*return*/, Promise.resolve()
		                                        .then(function () { return onclone(documentClone, referenceElement); })
		                                        .then(function () { return iframe; })];
		                            }
		                            return [2 /*return*/, iframe];
		                    }
		                });
		            }); });
		            documentClone.open();
		            documentClone.write(serializeDoctype(document.doctype) + "<html></html>");
		            // Chrome scrolls the parent document for some reason after the write to the cloned window???
		            restoreOwnerScroll(this.referenceElement.ownerDocument, scrollX, scrollY);
		            documentClone.replaceChild(documentClone.adoptNode(this.documentElement), documentClone.documentElement);
		            documentClone.close();
		            return iframeLoad;
		        };
		        DocumentCloner.prototype.createElementClone = function (node) {
		            if (isDebugging(node, 2 /* CLONE */)) {
		                debugger;
		            }
		            if (isCanvasElement(node)) {
		                return this.createCanvasClone(node);
		            }
		            if (isVideoElement(node)) {
		                return this.createVideoClone(node);
		            }
		            if (isStyleElement(node)) {
		                return this.createStyleClone(node);
		            }
		            var clone = node.cloneNode(false);
		            if (isImageElement(clone)) {
		                if (isImageElement(node) && node.currentSrc && node.currentSrc !== node.src) {
		                    clone.src = node.currentSrc;
		                    clone.srcset = '';
		                }
		                if (clone.loading === 'lazy') {
		                    clone.loading = 'eager';
		                }
		            }
		            if (isCustomElement(clone)) {
		                return this.createCustomElementClone(clone);
		            }
		            return clone;
		        };
		        DocumentCloner.prototype.createCustomElementClone = function (node) {
		            var clone = document.createElement('html2canvascustomelement');
		            copyCSSStyles(node.style, clone);
		            return clone;
		        };
		        DocumentCloner.prototype.createStyleClone = function (node) {
		            try {
		                var sheet = node.sheet;
		                if (sheet && sheet.cssRules) {
		                    var css = [].slice.call(sheet.cssRules, 0).reduce(function (css, rule) {
		                        if (rule && typeof rule.cssText === 'string') {
		                            return css + rule.cssText;
		                        }
		                        return css;
		                    }, '');
		                    var style = node.cloneNode(false);
		                    style.textContent = css;
		                    return style;
		                }
		            }
		            catch (e) {
		                // accessing node.sheet.cssRules throws a DOMException
		                this.context.logger.error('Unable to access cssRules property', e);
		                if (e.name !== 'SecurityError') {
		                    throw e;
		                }
		            }
		            return node.cloneNode(false);
		        };
		        DocumentCloner.prototype.createCanvasClone = function (canvas) {
		            var _a;
		            if (this.options.inlineImages && canvas.ownerDocument) {
		                var img = canvas.ownerDocument.createElement('img');
		                try {
		                    img.src = canvas.toDataURL();
		                    return img;
		                }
		                catch (e) {
		                    this.context.logger.info("Unable to inline canvas contents, canvas is tainted", canvas);
		                }
		            }
		            var clonedCanvas = canvas.cloneNode(false);
		            try {
		                clonedCanvas.width = canvas.width;
		                clonedCanvas.height = canvas.height;
		                var ctx = canvas.getContext('2d');
		                var clonedCtx = clonedCanvas.getContext('2d');
		                if (clonedCtx) {
		                    if (!this.options.allowTaint && ctx) {
		                        clonedCtx.putImageData(ctx.getImageData(0, 0, canvas.width, canvas.height), 0, 0);
		                    }
		                    else {
		                        var gl = (_a = canvas.getContext('webgl2')) !== null && _a !== void 0 ? _a : canvas.getContext('webgl');
		                        if (gl) {
		                            var attribs = gl.getContextAttributes();
		                            if ((attribs === null || attribs === void 0 ? void 0 : attribs.preserveDrawingBuffer) === false) {
		                                this.context.logger.warn('Unable to clone WebGL context as it has preserveDrawingBuffer=false', canvas);
		                            }
		                        }
		                        clonedCtx.drawImage(canvas, 0, 0);
		                    }
		                }
		                return clonedCanvas;
		            }
		            catch (e) {
		                this.context.logger.info("Unable to clone canvas as it is tainted", canvas);
		            }
		            return clonedCanvas;
		        };
		        DocumentCloner.prototype.createVideoClone = function (video) {
		            var canvas = video.ownerDocument.createElement('canvas');
		            canvas.width = video.offsetWidth;
		            canvas.height = video.offsetHeight;
		            var ctx = canvas.getContext('2d');
		            try {
		                if (ctx) {
		                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
		                    if (!this.options.allowTaint) {
		                        ctx.getImageData(0, 0, canvas.width, canvas.height);
		                    }
		                }
		                return canvas;
		            }
		            catch (e) {
		                this.context.logger.info("Unable to clone video as it is tainted", video);
		            }
		            var blankCanvas = video.ownerDocument.createElement('canvas');
		            blankCanvas.width = video.offsetWidth;
		            blankCanvas.height = video.offsetHeight;
		            return blankCanvas;
		        };
		        DocumentCloner.prototype.appendChildNode = function (clone, child, copyStyles) {
		            if (!isElementNode(child) ||
		                (!isScriptElement(child) &&
		                    !child.hasAttribute(IGNORE_ATTRIBUTE) &&
		                    (typeof this.options.ignoreElements !== 'function' || !this.options.ignoreElements(child)))) {
		                if (!this.options.copyStyles || !isElementNode(child) || !isStyleElement(child)) {
		                    clone.appendChild(this.cloneNode(child, copyStyles));
		                }
		            }
		        };
		        DocumentCloner.prototype.cloneChildNodes = function (node, clone, copyStyles) {
		            var _this = this;
		            for (var child = node.shadowRoot ? node.shadowRoot.firstChild : node.firstChild; child; child = child.nextSibling) {
		                if (isElementNode(child) && isSlotElement(child) && typeof child.assignedNodes === 'function') {
		                    var assignedNodes = child.assignedNodes();
		                    if (assignedNodes.length) {
		                        assignedNodes.forEach(function (assignedNode) { return _this.appendChildNode(clone, assignedNode, copyStyles); });
		                    }
		                }
		                else {
		                    this.appendChildNode(clone, child, copyStyles);
		                }
		            }
		        };
		        DocumentCloner.prototype.cloneNode = function (node, copyStyles) {
		            if (isTextNode(node)) {
		                return document.createTextNode(node.data);
		            }
		            if (!node.ownerDocument) {
		                return node.cloneNode(false);
		            }
		            var window = node.ownerDocument.defaultView;
		            if (window && isElementNode(node) && (isHTMLElementNode(node) || isSVGElementNode(node))) {
		                var clone = this.createElementClone(node);
		                clone.style.transitionProperty = 'none';
		                var style = window.getComputedStyle(node);
		                var styleBefore = window.getComputedStyle(node, ':before');
		                var styleAfter = window.getComputedStyle(node, ':after');
		                if (this.referenceElement === node && isHTMLElementNode(clone)) {
		                    this.clonedReferenceElement = clone;
		                }
		                if (isBodyElement(clone)) {
		                    createPseudoHideStyles(clone);
		                }
		                var counters = this.counters.parse(new CSSParsedCounterDeclaration(this.context, style));
		                var before = this.resolvePseudoContent(node, clone, styleBefore, PseudoElementType.BEFORE);
		                if (isCustomElement(node)) {
		                    copyStyles = true;
		                }
		                if (!isVideoElement(node)) {
		                    this.cloneChildNodes(node, clone, copyStyles);
		                }
		                if (before) {
		                    clone.insertBefore(before, clone.firstChild);
		                }
		                var after = this.resolvePseudoContent(node, clone, styleAfter, PseudoElementType.AFTER);
		                if (after) {
		                    clone.appendChild(after);
		                }
		                this.counters.pop(counters);
		                if ((style && (this.options.copyStyles || isSVGElementNode(node)) && !isIFrameElement(node)) ||
		                    copyStyles) {
		                    copyCSSStyles(style, clone);
		                }
		                if (node.scrollTop !== 0 || node.scrollLeft !== 0) {
		                    this.scrolledElements.push([clone, node.scrollLeft, node.scrollTop]);
		                }
		                if ((isTextareaElement(node) || isSelectElement(node)) &&
		                    (isTextareaElement(clone) || isSelectElement(clone))) {
		                    clone.value = node.value;
		                }
		                return clone;
		            }
		            return node.cloneNode(false);
		        };
		        DocumentCloner.prototype.resolvePseudoContent = function (node, clone, style, pseudoElt) {
		            var _this = this;
		            if (!style) {
		                return;
		            }
		            var value = style.content;
		            var document = clone.ownerDocument;
		            if (!document || !value || value === 'none' || value === '-moz-alt-content' || style.display === 'none') {
		                return;
		            }
		            this.counters.parse(new CSSParsedCounterDeclaration(this.context, style));
		            var declaration = new CSSParsedPseudoDeclaration(this.context, style);
		            var anonymousReplacedElement = document.createElement('html2canvaspseudoelement');
		            copyCSSStyles(style, anonymousReplacedElement);
		            declaration.content.forEach(function (token) {
		                if (token.type === 0 /* STRING_TOKEN */) {
		                    anonymousReplacedElement.appendChild(document.createTextNode(token.value));
		                }
		                else if (token.type === 22 /* URL_TOKEN */) {
		                    var img = document.createElement('img');
		                    img.src = token.value;
		                    img.style.opacity = '1';
		                    anonymousReplacedElement.appendChild(img);
		                }
		                else if (token.type === 18 /* FUNCTION */) {
		                    if (token.name === 'attr') {
		                        var attr = token.values.filter(isIdentToken);
		                        if (attr.length) {
		                            anonymousReplacedElement.appendChild(document.createTextNode(node.getAttribute(attr[0].value) || ''));
		                        }
		                    }
		                    else if (token.name === 'counter') {
		                        var _a = token.values.filter(nonFunctionArgSeparator), counter = _a[0], counterStyle = _a[1];
		                        if (counter && isIdentToken(counter)) {
		                            var counterState = _this.counters.getCounterValue(counter.value);
		                            var counterType = counterStyle && isIdentToken(counterStyle)
		                                ? listStyleType.parse(_this.context, counterStyle.value)
		                                : 3 /* DECIMAL */;
		                            anonymousReplacedElement.appendChild(document.createTextNode(createCounterText(counterState, counterType, false)));
		                        }
		                    }
		                    else if (token.name === 'counters') {
		                        var _b = token.values.filter(nonFunctionArgSeparator), counter = _b[0], delim = _b[1], counterStyle = _b[2];
		                        if (counter && isIdentToken(counter)) {
		                            var counterStates = _this.counters.getCounterValues(counter.value);
		                            var counterType_1 = counterStyle && isIdentToken(counterStyle)
		                                ? listStyleType.parse(_this.context, counterStyle.value)
		                                : 3 /* DECIMAL */;
		                            var separator = delim && delim.type === 0 /* STRING_TOKEN */ ? delim.value : '';
		                            var text = counterStates
		                                .map(function (value) { return createCounterText(value, counterType_1, false); })
		                                .join(separator);
		                            anonymousReplacedElement.appendChild(document.createTextNode(text));
		                        }
		                    }
		                    else ;
		                }
		                else if (token.type === 20 /* IDENT_TOKEN */) {
		                    switch (token.value) {
		                        case 'open-quote':
		                            anonymousReplacedElement.appendChild(document.createTextNode(getQuote(declaration.quotes, _this.quoteDepth++, true)));
		                            break;
		                        case 'close-quote':
		                            anonymousReplacedElement.appendChild(document.createTextNode(getQuote(declaration.quotes, --_this.quoteDepth, false)));
		                            break;
		                        default:
		                            // safari doesn't parse string tokens correctly because of lack of quotes
		                            anonymousReplacedElement.appendChild(document.createTextNode(token.value));
		                    }
		                }
		            });
		            anonymousReplacedElement.className = PSEUDO_HIDE_ELEMENT_CLASS_BEFORE + " " + PSEUDO_HIDE_ELEMENT_CLASS_AFTER;
		            var newClassName = pseudoElt === PseudoElementType.BEFORE
		                ? " " + PSEUDO_HIDE_ELEMENT_CLASS_BEFORE
		                : " " + PSEUDO_HIDE_ELEMENT_CLASS_AFTER;
		            if (isSVGElementNode(clone)) {
		                clone.className.baseValue += newClassName;
		            }
		            else {
		                clone.className += newClassName;
		            }
		            return anonymousReplacedElement;
		        };
		        DocumentCloner.destroy = function (container) {
		            if (container.parentNode) {
		                container.parentNode.removeChild(container);
		                return true;
		            }
		            return false;
		        };
		        return DocumentCloner;
		    }());
		    var PseudoElementType;
		    (function (PseudoElementType) {
		        PseudoElementType[PseudoElementType["BEFORE"] = 0] = "BEFORE";
		        PseudoElementType[PseudoElementType["AFTER"] = 1] = "AFTER";
		    })(PseudoElementType || (PseudoElementType = {}));
		    var createIFrameContainer = function (ownerDocument, bounds) {
		        var cloneIframeContainer = ownerDocument.createElement('iframe');
		        cloneIframeContainer.className = 'html2canvas-container';
		        cloneIframeContainer.style.visibility = 'hidden';
		        cloneIframeContainer.style.position = 'fixed';
		        cloneIframeContainer.style.left = '-10000px';
		        cloneIframeContainer.style.top = '0px';
		        cloneIframeContainer.style.border = '0';
		        cloneIframeContainer.width = bounds.width.toString();
		        cloneIframeContainer.height = bounds.height.toString();
		        cloneIframeContainer.scrolling = 'no'; // ios won't scroll without it
		        cloneIframeContainer.setAttribute(IGNORE_ATTRIBUTE, 'true');
		        ownerDocument.body.appendChild(cloneIframeContainer);
		        return cloneIframeContainer;
		    };
		    var imageReady = function (img) {
		        return new Promise(function (resolve) {
		            if (img.complete) {
		                resolve();
		                return;
		            }
		            if (!img.src) {
		                resolve();
		                return;
		            }
		            img.onload = resolve;
		            img.onerror = resolve;
		        });
		    };
		    var imagesReady = function (document) {
		        return Promise.all([].slice.call(document.images, 0).map(imageReady));
		    };
		    var iframeLoader = function (iframe) {
		        return new Promise(function (resolve, reject) {
		            var cloneWindow = iframe.contentWindow;
		            if (!cloneWindow) {
		                return reject("No window assigned for iframe");
		            }
		            var documentClone = cloneWindow.document;
		            cloneWindow.onload = iframe.onload = function () {
		                cloneWindow.onload = iframe.onload = null;
		                var interval = setInterval(function () {
		                    if (documentClone.body.childNodes.length > 0 && documentClone.readyState === 'complete') {
		                        clearInterval(interval);
		                        resolve(iframe);
		                    }
		                }, 50);
		            };
		        });
		    };
		    var ignoredStyleProperties = [
		        'all',
		        'd',
		        'content' // Safari shows pseudoelements if content is set
		    ];
		    var copyCSSStyles = function (style, target) {
		        // Edge does not provide value for cssText
		        for (var i = style.length - 1; i >= 0; i--) {
		            var property = style.item(i);
		            if (ignoredStyleProperties.indexOf(property) === -1) {
		                target.style.setProperty(property, style.getPropertyValue(property));
		            }
		        }
		        return target;
		    };
		    var serializeDoctype = function (doctype) {
		        var str = '';
		        if (doctype) {
		            str += '<!DOCTYPE ';
		            if (doctype.name) {
		                str += doctype.name;
		            }
		            if (doctype.internalSubset) {
		                str += doctype.internalSubset;
		            }
		            if (doctype.publicId) {
		                str += "\"" + doctype.publicId + "\"";
		            }
		            if (doctype.systemId) {
		                str += "\"" + doctype.systemId + "\"";
		            }
		            str += '>';
		        }
		        return str;
		    };
		    var restoreOwnerScroll = function (ownerDocument, x, y) {
		        if (ownerDocument &&
		            ownerDocument.defaultView &&
		            (x !== ownerDocument.defaultView.pageXOffset || y !== ownerDocument.defaultView.pageYOffset)) {
		            ownerDocument.defaultView.scrollTo(x, y);
		        }
		    };
		    var restoreNodeScroll = function (_a) {
		        var element = _a[0], x = _a[1], y = _a[2];
		        element.scrollLeft = x;
		        element.scrollTop = y;
		    };
		    var PSEUDO_BEFORE = ':before';
		    var PSEUDO_AFTER = ':after';
		    var PSEUDO_HIDE_ELEMENT_CLASS_BEFORE = '___html2canvas___pseudoelement_before';
		    var PSEUDO_HIDE_ELEMENT_CLASS_AFTER = '___html2canvas___pseudoelement_after';
		    var PSEUDO_HIDE_ELEMENT_STYLE = "{\n    content: \"\" !important;\n    display: none !important;\n}";
		    var createPseudoHideStyles = function (body) {
		        createStyles(body, "." + PSEUDO_HIDE_ELEMENT_CLASS_BEFORE + PSEUDO_BEFORE + PSEUDO_HIDE_ELEMENT_STYLE + "\n         ." + PSEUDO_HIDE_ELEMENT_CLASS_AFTER + PSEUDO_AFTER + PSEUDO_HIDE_ELEMENT_STYLE);
		    };
		    var createStyles = function (body, styles) {
		        var document = body.ownerDocument;
		        if (document) {
		            var style = document.createElement('style');
		            style.textContent = styles;
		            body.appendChild(style);
		        }
		    };

		    var CacheStorage = /** @class */ (function () {
		        function CacheStorage() {
		        }
		        CacheStorage.getOrigin = function (url) {
		            var link = CacheStorage._link;
		            if (!link) {
		                return 'about:blank';
		            }
		            link.href = url;
		            link.href = link.href; // IE9, LOL! - http://jsfiddle.net/niklasvh/2e48b/
		            return link.protocol + link.hostname + link.port;
		        };
		        CacheStorage.isSameOrigin = function (src) {
		            return CacheStorage.getOrigin(src) === CacheStorage._origin;
		        };
		        CacheStorage.setContext = function (window) {
		            CacheStorage._link = window.document.createElement('a');
		            CacheStorage._origin = CacheStorage.getOrigin(window.location.href);
		        };
		        CacheStorage._origin = 'about:blank';
		        return CacheStorage;
		    }());
		    var Cache = /** @class */ (function () {
		        function Cache(context, _options) {
		            this.context = context;
		            this._options = _options;
		            // eslint-disable-next-line @typescript-eslint/no-explicit-any
		            this._cache = {};
		        }
		        Cache.prototype.addImage = function (src) {
		            var result = Promise.resolve();
		            if (this.has(src)) {
		                return result;
		            }
		            if (isBlobImage(src) || isRenderable(src)) {
		                (this._cache[src] = this.loadImage(src)).catch(function () {
		                    // prevent unhandled rejection
		                });
		                return result;
		            }
		            return result;
		        };
		        // eslint-disable-next-line @typescript-eslint/no-explicit-any
		        Cache.prototype.match = function (src) {
		            return this._cache[src];
		        };
		        Cache.prototype.loadImage = function (key) {
		            return __awaiter(this, void 0, void 0, function () {
		                var isSameOrigin, useCORS, useProxy, src;
		                var _this = this;
		                return __generator(this, function (_a) {
		                    switch (_a.label) {
		                        case 0:
		                            isSameOrigin = CacheStorage.isSameOrigin(key);
		                            useCORS = !isInlineImage(key) && this._options.useCORS === true && FEATURES.SUPPORT_CORS_IMAGES && !isSameOrigin;
		                            useProxy = !isInlineImage(key) &&
		                                !isSameOrigin &&
		                                !isBlobImage(key) &&
		                                typeof this._options.proxy === 'string' &&
		                                FEATURES.SUPPORT_CORS_XHR &&
		                                !useCORS;
		                            if (!isSameOrigin &&
		                                this._options.allowTaint === false &&
		                                !isInlineImage(key) &&
		                                !isBlobImage(key) &&
		                                !useProxy &&
		                                !useCORS) {
		                                return [2 /*return*/];
		                            }
		                            src = key;
		                            if (!useProxy) return [3 /*break*/, 2];
		                            return [4 /*yield*/, this.proxy(src)];
		                        case 1:
		                            src = _a.sent();
		                            _a.label = 2;
		                        case 2:
		                            this.context.logger.debug("Added image " + key.substring(0, 256));
		                            return [4 /*yield*/, new Promise(function (resolve, reject) {
		                                    var img = new Image();
		                                    img.onload = function () { return resolve(img); };
		                                    img.onerror = reject;
		                                    //ios safari 10.3 taints canvas with data urls unless crossOrigin is set to anonymous
		                                    if (isInlineBase64Image(src) || useCORS) {
		                                        img.crossOrigin = 'anonymous';
		                                    }
		                                    img.src = src;
		                                    if (img.complete === true) {
		                                        // Inline XML images may fail to parse, throwing an Error later on
		                                        setTimeout(function () { return resolve(img); }, 500);
		                                    }
		                                    if (_this._options.imageTimeout > 0) {
		                                        setTimeout(function () { return reject("Timed out (" + _this._options.imageTimeout + "ms) loading image"); }, _this._options.imageTimeout);
		                                    }
		                                })];
		                        case 3: return [2 /*return*/, _a.sent()];
		                    }
		                });
		            });
		        };
		        Cache.prototype.has = function (key) {
		            return typeof this._cache[key] !== 'undefined';
		        };
		        Cache.prototype.keys = function () {
		            return Promise.resolve(Object.keys(this._cache));
		        };
		        Cache.prototype.proxy = function (src) {
		            var _this = this;
		            var proxy = this._options.proxy;
		            if (!proxy) {
		                throw new Error('No proxy defined');
		            }
		            var key = src.substring(0, 256);
		            return new Promise(function (resolve, reject) {
		                var responseType = FEATURES.SUPPORT_RESPONSE_TYPE ? 'blob' : 'text';
		                var xhr = new XMLHttpRequest();
		                xhr.onload = function () {
		                    if (xhr.status === 200) {
		                        if (responseType === 'text') {
		                            resolve(xhr.response);
		                        }
		                        else {
		                            var reader_1 = new FileReader();
		                            reader_1.addEventListener('load', function () { return resolve(reader_1.result); }, false);
		                            reader_1.addEventListener('error', function (e) { return reject(e); }, false);
		                            reader_1.readAsDataURL(xhr.response);
		                        }
		                    }
		                    else {
		                        reject("Failed to proxy resource " + key + " with status code " + xhr.status);
		                    }
		                };
		                xhr.onerror = reject;
		                var queryString = proxy.indexOf('?') > -1 ? '&' : '?';
		                xhr.open('GET', "" + proxy + queryString + "url=" + encodeURIComponent(src) + "&responseType=" + responseType);
		                if (responseType !== 'text' && xhr instanceof XMLHttpRequest) {
		                    xhr.responseType = responseType;
		                }
		                if (_this._options.imageTimeout) {
		                    var timeout_1 = _this._options.imageTimeout;
		                    xhr.timeout = timeout_1;
		                    xhr.ontimeout = function () { return reject("Timed out (" + timeout_1 + "ms) proxying " + key); };
		                }
		                xhr.send();
		            });
		        };
		        return Cache;
		    }());
		    var INLINE_SVG = /^data:image\/svg\+xml/i;
		    var INLINE_BASE64 = /^data:image\/.*;base64,/i;
		    var INLINE_IMG = /^data:image\/.*/i;
		    var isRenderable = function (src) { return FEATURES.SUPPORT_SVG_DRAWING || !isSVG(src); };
		    var isInlineImage = function (src) { return INLINE_IMG.test(src); };
		    var isInlineBase64Image = function (src) { return INLINE_BASE64.test(src); };
		    var isBlobImage = function (src) { return src.substr(0, 4) === 'blob'; };
		    var isSVG = function (src) { return src.substr(-3).toLowerCase() === 'svg' || INLINE_SVG.test(src); };

		    var Vector = /** @class */ (function () {
		        function Vector(x, y) {
		            this.type = 0 /* VECTOR */;
		            this.x = x;
		            this.y = y;
		        }
		        Vector.prototype.add = function (deltaX, deltaY) {
		            return new Vector(this.x + deltaX, this.y + deltaY);
		        };
		        return Vector;
		    }());

		    var lerp = function (a, b, t) {
		        return new Vector(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
		    };
		    var BezierCurve = /** @class */ (function () {
		        function BezierCurve(start, startControl, endControl, end) {
		            this.type = 1 /* BEZIER_CURVE */;
		            this.start = start;
		            this.startControl = startControl;
		            this.endControl = endControl;
		            this.end = end;
		        }
		        BezierCurve.prototype.subdivide = function (t, firstHalf) {
		            var ab = lerp(this.start, this.startControl, t);
		            var bc = lerp(this.startControl, this.endControl, t);
		            var cd = lerp(this.endControl, this.end, t);
		            var abbc = lerp(ab, bc, t);
		            var bccd = lerp(bc, cd, t);
		            var dest = lerp(abbc, bccd, t);
		            return firstHalf ? new BezierCurve(this.start, ab, abbc, dest) : new BezierCurve(dest, bccd, cd, this.end);
		        };
		        BezierCurve.prototype.add = function (deltaX, deltaY) {
		            return new BezierCurve(this.start.add(deltaX, deltaY), this.startControl.add(deltaX, deltaY), this.endControl.add(deltaX, deltaY), this.end.add(deltaX, deltaY));
		        };
		        BezierCurve.prototype.reverse = function () {
		            return new BezierCurve(this.end, this.endControl, this.startControl, this.start);
		        };
		        return BezierCurve;
		    }());
		    var isBezierCurve = function (path) { return path.type === 1 /* BEZIER_CURVE */; };

		    var BoundCurves = /** @class */ (function () {
		        function BoundCurves(element) {
		            var styles = element.styles;
		            var bounds = element.bounds;
		            var _a = getAbsoluteValueForTuple(styles.borderTopLeftRadius, bounds.width, bounds.height), tlh = _a[0], tlv = _a[1];
		            var _b = getAbsoluteValueForTuple(styles.borderTopRightRadius, bounds.width, bounds.height), trh = _b[0], trv = _b[1];
		            var _c = getAbsoluteValueForTuple(styles.borderBottomRightRadius, bounds.width, bounds.height), brh = _c[0], brv = _c[1];
		            var _d = getAbsoluteValueForTuple(styles.borderBottomLeftRadius, bounds.width, bounds.height), blh = _d[0], blv = _d[1];
		            var factors = [];
		            factors.push((tlh + trh) / bounds.width);
		            factors.push((blh + brh) / bounds.width);
		            factors.push((tlv + blv) / bounds.height);
		            factors.push((trv + brv) / bounds.height);
		            var maxFactor = Math.max.apply(Math, factors);
		            if (maxFactor > 1) {
		                tlh /= maxFactor;
		                tlv /= maxFactor;
		                trh /= maxFactor;
		                trv /= maxFactor;
		                brh /= maxFactor;
		                brv /= maxFactor;
		                blh /= maxFactor;
		                blv /= maxFactor;
		            }
		            var topWidth = bounds.width - trh;
		            var rightHeight = bounds.height - brv;
		            var bottomWidth = bounds.width - brh;
		            var leftHeight = bounds.height - blv;
		            var borderTopWidth = styles.borderTopWidth;
		            var borderRightWidth = styles.borderRightWidth;
		            var borderBottomWidth = styles.borderBottomWidth;
		            var borderLeftWidth = styles.borderLeftWidth;
		            var paddingTop = getAbsoluteValue(styles.paddingTop, element.bounds.width);
		            var paddingRight = getAbsoluteValue(styles.paddingRight, element.bounds.width);
		            var paddingBottom = getAbsoluteValue(styles.paddingBottom, element.bounds.width);
		            var paddingLeft = getAbsoluteValue(styles.paddingLeft, element.bounds.width);
		            this.topLeftBorderDoubleOuterBox =
		                tlh > 0 || tlv > 0
		                    ? getCurvePoints(bounds.left + borderLeftWidth / 3, bounds.top + borderTopWidth / 3, tlh - borderLeftWidth / 3, tlv - borderTopWidth / 3, CORNER.TOP_LEFT)
		                    : new Vector(bounds.left + borderLeftWidth / 3, bounds.top + borderTopWidth / 3);
		            this.topRightBorderDoubleOuterBox =
		                tlh > 0 || tlv > 0
		                    ? getCurvePoints(bounds.left + topWidth, bounds.top + borderTopWidth / 3, trh - borderRightWidth / 3, trv - borderTopWidth / 3, CORNER.TOP_RIGHT)
		                    : new Vector(bounds.left + bounds.width - borderRightWidth / 3, bounds.top + borderTopWidth / 3);
		            this.bottomRightBorderDoubleOuterBox =
		                brh > 0 || brv > 0
		                    ? getCurvePoints(bounds.left + bottomWidth, bounds.top + rightHeight, brh - borderRightWidth / 3, brv - borderBottomWidth / 3, CORNER.BOTTOM_RIGHT)
		                    : new Vector(bounds.left + bounds.width - borderRightWidth / 3, bounds.top + bounds.height - borderBottomWidth / 3);
		            this.bottomLeftBorderDoubleOuterBox =
		                blh > 0 || blv > 0
		                    ? getCurvePoints(bounds.left + borderLeftWidth / 3, bounds.top + leftHeight, blh - borderLeftWidth / 3, blv - borderBottomWidth / 3, CORNER.BOTTOM_LEFT)
		                    : new Vector(bounds.left + borderLeftWidth / 3, bounds.top + bounds.height - borderBottomWidth / 3);
		            this.topLeftBorderDoubleInnerBox =
		                tlh > 0 || tlv > 0
		                    ? getCurvePoints(bounds.left + (borderLeftWidth * 2) / 3, bounds.top + (borderTopWidth * 2) / 3, tlh - (borderLeftWidth * 2) / 3, tlv - (borderTopWidth * 2) / 3, CORNER.TOP_LEFT)
		                    : new Vector(bounds.left + (borderLeftWidth * 2) / 3, bounds.top + (borderTopWidth * 2) / 3);
		            this.topRightBorderDoubleInnerBox =
		                tlh > 0 || tlv > 0
		                    ? getCurvePoints(bounds.left + topWidth, bounds.top + (borderTopWidth * 2) / 3, trh - (borderRightWidth * 2) / 3, trv - (borderTopWidth * 2) / 3, CORNER.TOP_RIGHT)
		                    : new Vector(bounds.left + bounds.width - (borderRightWidth * 2) / 3, bounds.top + (borderTopWidth * 2) / 3);
		            this.bottomRightBorderDoubleInnerBox =
		                brh > 0 || brv > 0
		                    ? getCurvePoints(bounds.left + bottomWidth, bounds.top + rightHeight, brh - (borderRightWidth * 2) / 3, brv - (borderBottomWidth * 2) / 3, CORNER.BOTTOM_RIGHT)
		                    : new Vector(bounds.left + bounds.width - (borderRightWidth * 2) / 3, bounds.top + bounds.height - (borderBottomWidth * 2) / 3);
		            this.bottomLeftBorderDoubleInnerBox =
		                blh > 0 || blv > 0
		                    ? getCurvePoints(bounds.left + (borderLeftWidth * 2) / 3, bounds.top + leftHeight, blh - (borderLeftWidth * 2) / 3, blv - (borderBottomWidth * 2) / 3, CORNER.BOTTOM_LEFT)
		                    : new Vector(bounds.left + (borderLeftWidth * 2) / 3, bounds.top + bounds.height - (borderBottomWidth * 2) / 3);
		            this.topLeftBorderStroke =
		                tlh > 0 || tlv > 0
		                    ? getCurvePoints(bounds.left + borderLeftWidth / 2, bounds.top + borderTopWidth / 2, tlh - borderLeftWidth / 2, tlv - borderTopWidth / 2, CORNER.TOP_LEFT)
		                    : new Vector(bounds.left + borderLeftWidth / 2, bounds.top + borderTopWidth / 2);
		            this.topRightBorderStroke =
		                tlh > 0 || tlv > 0
		                    ? getCurvePoints(bounds.left + topWidth, bounds.top + borderTopWidth / 2, trh - borderRightWidth / 2, trv - borderTopWidth / 2, CORNER.TOP_RIGHT)
		                    : new Vector(bounds.left + bounds.width - borderRightWidth / 2, bounds.top + borderTopWidth / 2);
		            this.bottomRightBorderStroke =
		                brh > 0 || brv > 0
		                    ? getCurvePoints(bounds.left + bottomWidth, bounds.top + rightHeight, brh - borderRightWidth / 2, brv - borderBottomWidth / 2, CORNER.BOTTOM_RIGHT)
		                    : new Vector(bounds.left + bounds.width - borderRightWidth / 2, bounds.top + bounds.height - borderBottomWidth / 2);
		            this.bottomLeftBorderStroke =
		                blh > 0 || blv > 0
		                    ? getCurvePoints(bounds.left + borderLeftWidth / 2, bounds.top + leftHeight, blh - borderLeftWidth / 2, blv - borderBottomWidth / 2, CORNER.BOTTOM_LEFT)
		                    : new Vector(bounds.left + borderLeftWidth / 2, bounds.top + bounds.height - borderBottomWidth / 2);
		            this.topLeftBorderBox =
		                tlh > 0 || tlv > 0
		                    ? getCurvePoints(bounds.left, bounds.top, tlh, tlv, CORNER.TOP_LEFT)
		                    : new Vector(bounds.left, bounds.top);
		            this.topRightBorderBox =
		                trh > 0 || trv > 0
		                    ? getCurvePoints(bounds.left + topWidth, bounds.top, trh, trv, CORNER.TOP_RIGHT)
		                    : new Vector(bounds.left + bounds.width, bounds.top);
		            this.bottomRightBorderBox =
		                brh > 0 || brv > 0
		                    ? getCurvePoints(bounds.left + bottomWidth, bounds.top + rightHeight, brh, brv, CORNER.BOTTOM_RIGHT)
		                    : new Vector(bounds.left + bounds.width, bounds.top + bounds.height);
		            this.bottomLeftBorderBox =
		                blh > 0 || blv > 0
		                    ? getCurvePoints(bounds.left, bounds.top + leftHeight, blh, blv, CORNER.BOTTOM_LEFT)
		                    : new Vector(bounds.left, bounds.top + bounds.height);
		            this.topLeftPaddingBox =
		                tlh > 0 || tlv > 0
		                    ? getCurvePoints(bounds.left + borderLeftWidth, bounds.top + borderTopWidth, Math.max(0, tlh - borderLeftWidth), Math.max(0, tlv - borderTopWidth), CORNER.TOP_LEFT)
		                    : new Vector(bounds.left + borderLeftWidth, bounds.top + borderTopWidth);
		            this.topRightPaddingBox =
		                trh > 0 || trv > 0
		                    ? getCurvePoints(bounds.left + Math.min(topWidth, bounds.width - borderRightWidth), bounds.top + borderTopWidth, topWidth > bounds.width + borderRightWidth ? 0 : Math.max(0, trh - borderRightWidth), Math.max(0, trv - borderTopWidth), CORNER.TOP_RIGHT)
		                    : new Vector(bounds.left + bounds.width - borderRightWidth, bounds.top + borderTopWidth);
		            this.bottomRightPaddingBox =
		                brh > 0 || brv > 0
		                    ? getCurvePoints(bounds.left + Math.min(bottomWidth, bounds.width - borderLeftWidth), bounds.top + Math.min(rightHeight, bounds.height - borderBottomWidth), Math.max(0, brh - borderRightWidth), Math.max(0, brv - borderBottomWidth), CORNER.BOTTOM_RIGHT)
		                    : new Vector(bounds.left + bounds.width - borderRightWidth, bounds.top + bounds.height - borderBottomWidth);
		            this.bottomLeftPaddingBox =
		                blh > 0 || blv > 0
		                    ? getCurvePoints(bounds.left + borderLeftWidth, bounds.top + Math.min(leftHeight, bounds.height - borderBottomWidth), Math.max(0, blh - borderLeftWidth), Math.max(0, blv - borderBottomWidth), CORNER.BOTTOM_LEFT)
		                    : new Vector(bounds.left + borderLeftWidth, bounds.top + bounds.height - borderBottomWidth);
		            this.topLeftContentBox =
		                tlh > 0 || tlv > 0
		                    ? getCurvePoints(bounds.left + borderLeftWidth + paddingLeft, bounds.top + borderTopWidth + paddingTop, Math.max(0, tlh - (borderLeftWidth + paddingLeft)), Math.max(0, tlv - (borderTopWidth + paddingTop)), CORNER.TOP_LEFT)
		                    : new Vector(bounds.left + borderLeftWidth + paddingLeft, bounds.top + borderTopWidth + paddingTop);
		            this.topRightContentBox =
		                trh > 0 || trv > 0
		                    ? getCurvePoints(bounds.left + Math.min(topWidth, bounds.width + borderLeftWidth + paddingLeft), bounds.top + borderTopWidth + paddingTop, topWidth > bounds.width + borderLeftWidth + paddingLeft ? 0 : trh - borderLeftWidth + paddingLeft, trv - (borderTopWidth + paddingTop), CORNER.TOP_RIGHT)
		                    : new Vector(bounds.left + bounds.width - (borderRightWidth + paddingRight), bounds.top + borderTopWidth + paddingTop);
		            this.bottomRightContentBox =
		                brh > 0 || brv > 0
		                    ? getCurvePoints(bounds.left + Math.min(bottomWidth, bounds.width - (borderLeftWidth + paddingLeft)), bounds.top + Math.min(rightHeight, bounds.height + borderTopWidth + paddingTop), Math.max(0, brh - (borderRightWidth + paddingRight)), brv - (borderBottomWidth + paddingBottom), CORNER.BOTTOM_RIGHT)
		                    : new Vector(bounds.left + bounds.width - (borderRightWidth + paddingRight), bounds.top + bounds.height - (borderBottomWidth + paddingBottom));
		            this.bottomLeftContentBox =
		                blh > 0 || blv > 0
		                    ? getCurvePoints(bounds.left + borderLeftWidth + paddingLeft, bounds.top + leftHeight, Math.max(0, blh - (borderLeftWidth + paddingLeft)), blv - (borderBottomWidth + paddingBottom), CORNER.BOTTOM_LEFT)
		                    : new Vector(bounds.left + borderLeftWidth + paddingLeft, bounds.top + bounds.height - (borderBottomWidth + paddingBottom));
		        }
		        return BoundCurves;
		    }());
		    var CORNER;
		    (function (CORNER) {
		        CORNER[CORNER["TOP_LEFT"] = 0] = "TOP_LEFT";
		        CORNER[CORNER["TOP_RIGHT"] = 1] = "TOP_RIGHT";
		        CORNER[CORNER["BOTTOM_RIGHT"] = 2] = "BOTTOM_RIGHT";
		        CORNER[CORNER["BOTTOM_LEFT"] = 3] = "BOTTOM_LEFT";
		    })(CORNER || (CORNER = {}));
		    var getCurvePoints = function (x, y, r1, r2, position) {
		        var kappa = 4 * ((Math.sqrt(2) - 1) / 3);
		        var ox = r1 * kappa; // control point offset horizontal
		        var oy = r2 * kappa; // control point offset vertical
		        var xm = x + r1; // x-middle
		        var ym = y + r2; // y-middle
		        switch (position) {
		            case CORNER.TOP_LEFT:
		                return new BezierCurve(new Vector(x, ym), new Vector(x, ym - oy), new Vector(xm - ox, y), new Vector(xm, y));
		            case CORNER.TOP_RIGHT:
		                return new BezierCurve(new Vector(x, y), new Vector(x + ox, y), new Vector(xm, ym - oy), new Vector(xm, ym));
		            case CORNER.BOTTOM_RIGHT:
		                return new BezierCurve(new Vector(xm, y), new Vector(xm, y + oy), new Vector(x + ox, ym), new Vector(x, ym));
		            case CORNER.BOTTOM_LEFT:
		            default:
		                return new BezierCurve(new Vector(xm, ym), new Vector(xm - ox, ym), new Vector(x, y + oy), new Vector(x, y));
		        }
		    };
		    var calculateBorderBoxPath = function (curves) {
		        return [curves.topLeftBorderBox, curves.topRightBorderBox, curves.bottomRightBorderBox, curves.bottomLeftBorderBox];
		    };
		    var calculateContentBoxPath = function (curves) {
		        return [
		            curves.topLeftContentBox,
		            curves.topRightContentBox,
		            curves.bottomRightContentBox,
		            curves.bottomLeftContentBox
		        ];
		    };
		    var calculatePaddingBoxPath = function (curves) {
		        return [
		            curves.topLeftPaddingBox,
		            curves.topRightPaddingBox,
		            curves.bottomRightPaddingBox,
		            curves.bottomLeftPaddingBox
		        ];
		    };

		    var TransformEffect = /** @class */ (function () {
		        function TransformEffect(offsetX, offsetY, matrix) {
		            this.offsetX = offsetX;
		            this.offsetY = offsetY;
		            this.matrix = matrix;
		            this.type = 0 /* TRANSFORM */;
		            this.target = 2 /* BACKGROUND_BORDERS */ | 4 /* CONTENT */;
		        }
		        return TransformEffect;
		    }());
		    var ClipEffect = /** @class */ (function () {
		        function ClipEffect(path, target) {
		            this.path = path;
		            this.target = target;
		            this.type = 1 /* CLIP */;
		        }
		        return ClipEffect;
		    }());
		    var OpacityEffect = /** @class */ (function () {
		        function OpacityEffect(opacity) {
		            this.opacity = opacity;
		            this.type = 2 /* OPACITY */;
		            this.target = 2 /* BACKGROUND_BORDERS */ | 4 /* CONTENT */;
		        }
		        return OpacityEffect;
		    }());
		    var isTransformEffect = function (effect) {
		        return effect.type === 0 /* TRANSFORM */;
		    };
		    var isClipEffect = function (effect) { return effect.type === 1 /* CLIP */; };
		    var isOpacityEffect = function (effect) { return effect.type === 2 /* OPACITY */; };

		    var equalPath = function (a, b) {
		        if (a.length === b.length) {
		            return a.some(function (v, i) { return v === b[i]; });
		        }
		        return false;
		    };
		    var transformPath = function (path, deltaX, deltaY, deltaW, deltaH) {
		        return path.map(function (point, index) {
		            switch (index) {
		                case 0:
		                    return point.add(deltaX, deltaY);
		                case 1:
		                    return point.add(deltaX + deltaW, deltaY);
		                case 2:
		                    return point.add(deltaX + deltaW, deltaY + deltaH);
		                case 3:
		                    return point.add(deltaX, deltaY + deltaH);
		            }
		            return point;
		        });
		    };

		    var StackingContext = /** @class */ (function () {
		        function StackingContext(container) {
		            this.element = container;
		            this.inlineLevel = [];
		            this.nonInlineLevel = [];
		            this.negativeZIndex = [];
		            this.zeroOrAutoZIndexOrTransformedOrOpacity = [];
		            this.positiveZIndex = [];
		            this.nonPositionedFloats = [];
		            this.nonPositionedInlineLevel = [];
		        }
		        return StackingContext;
		    }());
		    var ElementPaint = /** @class */ (function () {
		        function ElementPaint(container, parent) {
		            this.container = container;
		            this.parent = parent;
		            this.effects = [];
		            this.curves = new BoundCurves(this.container);
		            if (this.container.styles.opacity < 1) {
		                this.effects.push(new OpacityEffect(this.container.styles.opacity));
		            }
		            if (this.container.styles.transform !== null) {
		                var offsetX = this.container.bounds.left + this.container.styles.transformOrigin[0].number;
		                var offsetY = this.container.bounds.top + this.container.styles.transformOrigin[1].number;
		                var matrix = this.container.styles.transform;
		                this.effects.push(new TransformEffect(offsetX, offsetY, matrix));
		            }
		            if (this.container.styles.overflowX !== 0 /* VISIBLE */) {
		                var borderBox = calculateBorderBoxPath(this.curves);
		                var paddingBox = calculatePaddingBoxPath(this.curves);
		                if (equalPath(borderBox, paddingBox)) {
		                    this.effects.push(new ClipEffect(borderBox, 2 /* BACKGROUND_BORDERS */ | 4 /* CONTENT */));
		                }
		                else {
		                    this.effects.push(new ClipEffect(borderBox, 2 /* BACKGROUND_BORDERS */));
		                    this.effects.push(new ClipEffect(paddingBox, 4 /* CONTENT */));
		                }
		            }
		        }
		        ElementPaint.prototype.getEffects = function (target) {
		            var inFlow = [2 /* ABSOLUTE */, 3 /* FIXED */].indexOf(this.container.styles.position) === -1;
		            var parent = this.parent;
		            var effects = this.effects.slice(0);
		            while (parent) {
		                var croplessEffects = parent.effects.filter(function (effect) { return !isClipEffect(effect); });
		                if (inFlow || parent.container.styles.position !== 0 /* STATIC */ || !parent.parent) {
		                    effects.unshift.apply(effects, croplessEffects);
		                    inFlow = [2 /* ABSOLUTE */, 3 /* FIXED */].indexOf(parent.container.styles.position) === -1;
		                    if (parent.container.styles.overflowX !== 0 /* VISIBLE */) {
		                        var borderBox = calculateBorderBoxPath(parent.curves);
		                        var paddingBox = calculatePaddingBoxPath(parent.curves);
		                        if (!equalPath(borderBox, paddingBox)) {
		                            effects.unshift(new ClipEffect(paddingBox, 2 /* BACKGROUND_BORDERS */ | 4 /* CONTENT */));
		                        }
		                    }
		                }
		                else {
		                    effects.unshift.apply(effects, croplessEffects);
		                }
		                parent = parent.parent;
		            }
		            return effects.filter(function (effect) { return contains(effect.target, target); });
		        };
		        return ElementPaint;
		    }());
		    var parseStackTree = function (parent, stackingContext, realStackingContext, listItems) {
		        parent.container.elements.forEach(function (child) {
		            var treatAsRealStackingContext = contains(child.flags, 4 /* CREATES_REAL_STACKING_CONTEXT */);
		            var createsStackingContext = contains(child.flags, 2 /* CREATES_STACKING_CONTEXT */);
		            var paintContainer = new ElementPaint(child, parent);
		            if (contains(child.styles.display, 2048 /* LIST_ITEM */)) {
		                listItems.push(paintContainer);
		            }
		            var listOwnerItems = contains(child.flags, 8 /* IS_LIST_OWNER */) ? [] : listItems;
		            if (treatAsRealStackingContext || createsStackingContext) {
		                var parentStack = treatAsRealStackingContext || child.styles.isPositioned() ? realStackingContext : stackingContext;
		                var stack = new StackingContext(paintContainer);
		                if (child.styles.isPositioned() || child.styles.opacity < 1 || child.styles.isTransformed()) {
		                    var order_1 = child.styles.zIndex.order;
		                    if (order_1 < 0) {
		                        var index_1 = 0;
		                        parentStack.negativeZIndex.some(function (current, i) {
		                            if (order_1 > current.element.container.styles.zIndex.order) {
		                                index_1 = i;
		                                return false;
		                            }
		                            else if (index_1 > 0) {
		                                return true;
		                            }
		                            return false;
		                        });
		                        parentStack.negativeZIndex.splice(index_1, 0, stack);
		                    }
		                    else if (order_1 > 0) {
		                        var index_2 = 0;
		                        parentStack.positiveZIndex.some(function (current, i) {
		                            if (order_1 >= current.element.container.styles.zIndex.order) {
		                                index_2 = i + 1;
		                                return false;
		                            }
		                            else if (index_2 > 0) {
		                                return true;
		                            }
		                            return false;
		                        });
		                        parentStack.positiveZIndex.splice(index_2, 0, stack);
		                    }
		                    else {
		                        parentStack.zeroOrAutoZIndexOrTransformedOrOpacity.push(stack);
		                    }
		                }
		                else {
		                    if (child.styles.isFloating()) {
		                        parentStack.nonPositionedFloats.push(stack);
		                    }
		                    else {
		                        parentStack.nonPositionedInlineLevel.push(stack);
		                    }
		                }
		                parseStackTree(paintContainer, stack, treatAsRealStackingContext ? stack : realStackingContext, listOwnerItems);
		            }
		            else {
		                if (child.styles.isInlineLevel()) {
		                    stackingContext.inlineLevel.push(paintContainer);
		                }
		                else {
		                    stackingContext.nonInlineLevel.push(paintContainer);
		                }
		                parseStackTree(paintContainer, stackingContext, realStackingContext, listOwnerItems);
		            }
		            if (contains(child.flags, 8 /* IS_LIST_OWNER */)) {
		                processListItems(child, listOwnerItems);
		            }
		        });
		    };
		    var processListItems = function (owner, elements) {
		        var numbering = owner instanceof OLElementContainer ? owner.start : 1;
		        var reversed = owner instanceof OLElementContainer ? owner.reversed : false;
		        for (var i = 0; i < elements.length; i++) {
		            var item = elements[i];
		            if (item.container instanceof LIElementContainer &&
		                typeof item.container.value === 'number' &&
		                item.container.value !== 0) {
		                numbering = item.container.value;
		            }
		            item.listValue = createCounterText(numbering, item.container.styles.listStyleType, true);
		            numbering += reversed ? -1 : 1;
		        }
		    };
		    var parseStackingContexts = function (container) {
		        var paintContainer = new ElementPaint(container, null);
		        var root = new StackingContext(paintContainer);
		        var listItems = [];
		        parseStackTree(paintContainer, root, root, listItems);
		        processListItems(paintContainer.container, listItems);
		        return root;
		    };

		    var parsePathForBorder = function (curves, borderSide) {
		        switch (borderSide) {
		            case 0:
		                return createPathFromCurves(curves.topLeftBorderBox, curves.topLeftPaddingBox, curves.topRightBorderBox, curves.topRightPaddingBox);
		            case 1:
		                return createPathFromCurves(curves.topRightBorderBox, curves.topRightPaddingBox, curves.bottomRightBorderBox, curves.bottomRightPaddingBox);
		            case 2:
		                return createPathFromCurves(curves.bottomRightBorderBox, curves.bottomRightPaddingBox, curves.bottomLeftBorderBox, curves.bottomLeftPaddingBox);
		            case 3:
		            default:
		                return createPathFromCurves(curves.bottomLeftBorderBox, curves.bottomLeftPaddingBox, curves.topLeftBorderBox, curves.topLeftPaddingBox);
		        }
		    };
		    var parsePathForBorderDoubleOuter = function (curves, borderSide) {
		        switch (borderSide) {
		            case 0:
		                return createPathFromCurves(curves.topLeftBorderBox, curves.topLeftBorderDoubleOuterBox, curves.topRightBorderBox, curves.topRightBorderDoubleOuterBox);
		            case 1:
		                return createPathFromCurves(curves.topRightBorderBox, curves.topRightBorderDoubleOuterBox, curves.bottomRightBorderBox, curves.bottomRightBorderDoubleOuterBox);
		            case 2:
		                return createPathFromCurves(curves.bottomRightBorderBox, curves.bottomRightBorderDoubleOuterBox, curves.bottomLeftBorderBox, curves.bottomLeftBorderDoubleOuterBox);
		            case 3:
		            default:
		                return createPathFromCurves(curves.bottomLeftBorderBox, curves.bottomLeftBorderDoubleOuterBox, curves.topLeftBorderBox, curves.topLeftBorderDoubleOuterBox);
		        }
		    };
		    var parsePathForBorderDoubleInner = function (curves, borderSide) {
		        switch (borderSide) {
		            case 0:
		                return createPathFromCurves(curves.topLeftBorderDoubleInnerBox, curves.topLeftPaddingBox, curves.topRightBorderDoubleInnerBox, curves.topRightPaddingBox);
		            case 1:
		                return createPathFromCurves(curves.topRightBorderDoubleInnerBox, curves.topRightPaddingBox, curves.bottomRightBorderDoubleInnerBox, curves.bottomRightPaddingBox);
		            case 2:
		                return createPathFromCurves(curves.bottomRightBorderDoubleInnerBox, curves.bottomRightPaddingBox, curves.bottomLeftBorderDoubleInnerBox, curves.bottomLeftPaddingBox);
		            case 3:
		            default:
		                return createPathFromCurves(curves.bottomLeftBorderDoubleInnerBox, curves.bottomLeftPaddingBox, curves.topLeftBorderDoubleInnerBox, curves.topLeftPaddingBox);
		        }
		    };
		    var parsePathForBorderStroke = function (curves, borderSide) {
		        switch (borderSide) {
		            case 0:
		                return createStrokePathFromCurves(curves.topLeftBorderStroke, curves.topRightBorderStroke);
		            case 1:
		                return createStrokePathFromCurves(curves.topRightBorderStroke, curves.bottomRightBorderStroke);
		            case 2:
		                return createStrokePathFromCurves(curves.bottomRightBorderStroke, curves.bottomLeftBorderStroke);
		            case 3:
		            default:
		                return createStrokePathFromCurves(curves.bottomLeftBorderStroke, curves.topLeftBorderStroke);
		        }
		    };
		    var createStrokePathFromCurves = function (outer1, outer2) {
		        var path = [];
		        if (isBezierCurve(outer1)) {
		            path.push(outer1.subdivide(0.5, false));
		        }
		        else {
		            path.push(outer1);
		        }
		        if (isBezierCurve(outer2)) {
		            path.push(outer2.subdivide(0.5, true));
		        }
		        else {
		            path.push(outer2);
		        }
		        return path;
		    };
		    var createPathFromCurves = function (outer1, inner1, outer2, inner2) {
		        var path = [];
		        if (isBezierCurve(outer1)) {
		            path.push(outer1.subdivide(0.5, false));
		        }
		        else {
		            path.push(outer1);
		        }
		        if (isBezierCurve(outer2)) {
		            path.push(outer2.subdivide(0.5, true));
		        }
		        else {
		            path.push(outer2);
		        }
		        if (isBezierCurve(inner2)) {
		            path.push(inner2.subdivide(0.5, true).reverse());
		        }
		        else {
		            path.push(inner2);
		        }
		        if (isBezierCurve(inner1)) {
		            path.push(inner1.subdivide(0.5, false).reverse());
		        }
		        else {
		            path.push(inner1);
		        }
		        return path;
		    };

		    var paddingBox = function (element) {
		        var bounds = element.bounds;
		        var styles = element.styles;
		        return bounds.add(styles.borderLeftWidth, styles.borderTopWidth, -(styles.borderRightWidth + styles.borderLeftWidth), -(styles.borderTopWidth + styles.borderBottomWidth));
		    };
		    var contentBox = function (element) {
		        var styles = element.styles;
		        var bounds = element.bounds;
		        var paddingLeft = getAbsoluteValue(styles.paddingLeft, bounds.width);
		        var paddingRight = getAbsoluteValue(styles.paddingRight, bounds.width);
		        var paddingTop = getAbsoluteValue(styles.paddingTop, bounds.width);
		        var paddingBottom = getAbsoluteValue(styles.paddingBottom, bounds.width);
		        return bounds.add(paddingLeft + styles.borderLeftWidth, paddingTop + styles.borderTopWidth, -(styles.borderRightWidth + styles.borderLeftWidth + paddingLeft + paddingRight), -(styles.borderTopWidth + styles.borderBottomWidth + paddingTop + paddingBottom));
		    };

		    var calculateBackgroundPositioningArea = function (backgroundOrigin, element) {
		        if (backgroundOrigin === 0 /* BORDER_BOX */) {
		            return element.bounds;
		        }
		        if (backgroundOrigin === 2 /* CONTENT_BOX */) {
		            return contentBox(element);
		        }
		        return paddingBox(element);
		    };
		    var calculateBackgroundPaintingArea = function (backgroundClip, element) {
		        if (backgroundClip === 0 /* BORDER_BOX */) {
		            return element.bounds;
		        }
		        if (backgroundClip === 2 /* CONTENT_BOX */) {
		            return contentBox(element);
		        }
		        return paddingBox(element);
		    };
		    var calculateBackgroundRendering = function (container, index, intrinsicSize) {
		        var backgroundPositioningArea = calculateBackgroundPositioningArea(getBackgroundValueForIndex(container.styles.backgroundOrigin, index), container);
		        var backgroundPaintingArea = calculateBackgroundPaintingArea(getBackgroundValueForIndex(container.styles.backgroundClip, index), container);
		        var backgroundImageSize = calculateBackgroundSize(getBackgroundValueForIndex(container.styles.backgroundSize, index), intrinsicSize, backgroundPositioningArea);
		        var sizeWidth = backgroundImageSize[0], sizeHeight = backgroundImageSize[1];
		        var position = getAbsoluteValueForTuple(getBackgroundValueForIndex(container.styles.backgroundPosition, index), backgroundPositioningArea.width - sizeWidth, backgroundPositioningArea.height - sizeHeight);
		        var path = calculateBackgroundRepeatPath(getBackgroundValueForIndex(container.styles.backgroundRepeat, index), position, backgroundImageSize, backgroundPositioningArea, backgroundPaintingArea);
		        var offsetX = Math.round(backgroundPositioningArea.left + position[0]);
		        var offsetY = Math.round(backgroundPositioningArea.top + position[1]);
		        return [path, offsetX, offsetY, sizeWidth, sizeHeight];
		    };
		    var isAuto = function (token) { return isIdentToken(token) && token.value === BACKGROUND_SIZE.AUTO; };
		    var hasIntrinsicValue = function (value) { return typeof value === 'number'; };
		    var calculateBackgroundSize = function (size, _a, bounds) {
		        var intrinsicWidth = _a[0], intrinsicHeight = _a[1], intrinsicProportion = _a[2];
		        var first = size[0], second = size[1];
		        if (!first) {
		            return [0, 0];
		        }
		        if (isLengthPercentage(first) && second && isLengthPercentage(second)) {
		            return [getAbsoluteValue(first, bounds.width), getAbsoluteValue(second, bounds.height)];
		        }
		        var hasIntrinsicProportion = hasIntrinsicValue(intrinsicProportion);
		        if (isIdentToken(first) && (first.value === BACKGROUND_SIZE.CONTAIN || first.value === BACKGROUND_SIZE.COVER)) {
		            if (hasIntrinsicValue(intrinsicProportion)) {
		                var targetRatio = bounds.width / bounds.height;
		                return targetRatio < intrinsicProportion !== (first.value === BACKGROUND_SIZE.COVER)
		                    ? [bounds.width, bounds.width / intrinsicProportion]
		                    : [bounds.height * intrinsicProportion, bounds.height];
		            }
		            return [bounds.width, bounds.height];
		        }
		        var hasIntrinsicWidth = hasIntrinsicValue(intrinsicWidth);
		        var hasIntrinsicHeight = hasIntrinsicValue(intrinsicHeight);
		        var hasIntrinsicDimensions = hasIntrinsicWidth || hasIntrinsicHeight;
		        // If the background-size is auto or auto auto:
		        if (isAuto(first) && (!second || isAuto(second))) {
		            // If the image has both horizontal and vertical intrinsic dimensions, it's rendered at that size.
		            if (hasIntrinsicWidth && hasIntrinsicHeight) {
		                return [intrinsicWidth, intrinsicHeight];
		            }
		            // If the image has no intrinsic dimensions and has no intrinsic proportions,
		            // it's rendered at the size of the background positioning area.
		            if (!hasIntrinsicProportion && !hasIntrinsicDimensions) {
		                return [bounds.width, bounds.height];
		            }
		            // TODO If the image has no intrinsic dimensions but has intrinsic proportions, it's rendered as if contain had been specified instead.
		            // If the image has only one intrinsic dimension and has intrinsic proportions, it's rendered at the size corresponding to that one dimension.
		            // The other dimension is computed using the specified dimension and the intrinsic proportions.
		            if (hasIntrinsicDimensions && hasIntrinsicProportion) {
		                var width_1 = hasIntrinsicWidth
		                    ? intrinsicWidth
		                    : intrinsicHeight * intrinsicProportion;
		                var height_1 = hasIntrinsicHeight
		                    ? intrinsicHeight
		                    : intrinsicWidth / intrinsicProportion;
		                return [width_1, height_1];
		            }
		            // If the image has only one intrinsic dimension but has no intrinsic proportions,
		            // it's rendered using the specified dimension and the other dimension of the background positioning area.
		            var width_2 = hasIntrinsicWidth ? intrinsicWidth : bounds.width;
		            var height_2 = hasIntrinsicHeight ? intrinsicHeight : bounds.height;
		            return [width_2, height_2];
		        }
		        // If the image has intrinsic proportions, it's stretched to the specified dimension.
		        // The unspecified dimension is computed using the specified dimension and the intrinsic proportions.
		        if (hasIntrinsicProportion) {
		            var width_3 = 0;
		            var height_3 = 0;
		            if (isLengthPercentage(first)) {
		                width_3 = getAbsoluteValue(first, bounds.width);
		            }
		            else if (isLengthPercentage(second)) {
		                height_3 = getAbsoluteValue(second, bounds.height);
		            }
		            if (isAuto(first)) {
		                width_3 = height_3 * intrinsicProportion;
		            }
		            else if (!second || isAuto(second)) {
		                height_3 = width_3 / intrinsicProportion;
		            }
		            return [width_3, height_3];
		        }
		        // If the image has no intrinsic proportions, it's stretched to the specified dimension.
		        // The unspecified dimension is computed using the image's corresponding intrinsic dimension,
		        // if there is one. If there is no such intrinsic dimension,
		        // it becomes the corresponding dimension of the background positioning area.
		        var width = null;
		        var height = null;
		        if (isLengthPercentage(first)) {
		            width = getAbsoluteValue(first, bounds.width);
		        }
		        else if (second && isLengthPercentage(second)) {
		            height = getAbsoluteValue(second, bounds.height);
		        }
		        if (width !== null && (!second || isAuto(second))) {
		            height =
		                hasIntrinsicWidth && hasIntrinsicHeight
		                    ? (width / intrinsicWidth) * intrinsicHeight
		                    : bounds.height;
		        }
		        if (height !== null && isAuto(first)) {
		            width =
		                hasIntrinsicWidth && hasIntrinsicHeight
		                    ? (height / intrinsicHeight) * intrinsicWidth
		                    : bounds.width;
		        }
		        if (width !== null && height !== null) {
		            return [width, height];
		        }
		        throw new Error("Unable to calculate background-size for element");
		    };
		    var getBackgroundValueForIndex = function (values, index) {
		        var value = values[index];
		        if (typeof value === 'undefined') {
		            return values[0];
		        }
		        return value;
		    };
		    var calculateBackgroundRepeatPath = function (repeat, _a, _b, backgroundPositioningArea, backgroundPaintingArea) {
		        var x = _a[0], y = _a[1];
		        var width = _b[0], height = _b[1];
		        switch (repeat) {
		            case 2 /* REPEAT_X */:
		                return [
		                    new Vector(Math.round(backgroundPositioningArea.left), Math.round(backgroundPositioningArea.top + y)),
		                    new Vector(Math.round(backgroundPositioningArea.left + backgroundPositioningArea.width), Math.round(backgroundPositioningArea.top + y)),
		                    new Vector(Math.round(backgroundPositioningArea.left + backgroundPositioningArea.width), Math.round(height + backgroundPositioningArea.top + y)),
		                    new Vector(Math.round(backgroundPositioningArea.left), Math.round(height + backgroundPositioningArea.top + y))
		                ];
		            case 3 /* REPEAT_Y */:
		                return [
		                    new Vector(Math.round(backgroundPositioningArea.left + x), Math.round(backgroundPositioningArea.top)),
		                    new Vector(Math.round(backgroundPositioningArea.left + x + width), Math.round(backgroundPositioningArea.top)),
		                    new Vector(Math.round(backgroundPositioningArea.left + x + width), Math.round(backgroundPositioningArea.height + backgroundPositioningArea.top)),
		                    new Vector(Math.round(backgroundPositioningArea.left + x), Math.round(backgroundPositioningArea.height + backgroundPositioningArea.top))
		                ];
		            case 1 /* NO_REPEAT */:
		                return [
		                    new Vector(Math.round(backgroundPositioningArea.left + x), Math.round(backgroundPositioningArea.top + y)),
		                    new Vector(Math.round(backgroundPositioningArea.left + x + width), Math.round(backgroundPositioningArea.top + y)),
		                    new Vector(Math.round(backgroundPositioningArea.left + x + width), Math.round(backgroundPositioningArea.top + y + height)),
		                    new Vector(Math.round(backgroundPositioningArea.left + x), Math.round(backgroundPositioningArea.top + y + height))
		                ];
		            default:
		                return [
		                    new Vector(Math.round(backgroundPaintingArea.left), Math.round(backgroundPaintingArea.top)),
		                    new Vector(Math.round(backgroundPaintingArea.left + backgroundPaintingArea.width), Math.round(backgroundPaintingArea.top)),
		                    new Vector(Math.round(backgroundPaintingArea.left + backgroundPaintingArea.width), Math.round(backgroundPaintingArea.height + backgroundPaintingArea.top)),
		                    new Vector(Math.round(backgroundPaintingArea.left), Math.round(backgroundPaintingArea.height + backgroundPaintingArea.top))
		                ];
		        }
		    };

		    var SMALL_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

		    var SAMPLE_TEXT = 'Hidden Text';
		    var FontMetrics = /** @class */ (function () {
		        function FontMetrics(document) {
		            this._data = {};
		            this._document = document;
		        }
		        FontMetrics.prototype.parseMetrics = function (fontFamily, fontSize) {
		            var container = this._document.createElement('div');
		            var img = this._document.createElement('img');
		            var span = this._document.createElement('span');
		            var body = this._document.body;
		            container.style.visibility = 'hidden';
		            container.style.fontFamily = fontFamily;
		            container.style.fontSize = fontSize;
		            container.style.margin = '0';
		            container.style.padding = '0';
		            container.style.whiteSpace = 'nowrap';
		            body.appendChild(container);
		            img.src = SMALL_IMAGE;
		            img.width = 1;
		            img.height = 1;
		            img.style.margin = '0';
		            img.style.padding = '0';
		            img.style.verticalAlign = 'baseline';
		            span.style.fontFamily = fontFamily;
		            span.style.fontSize = fontSize;
		            span.style.margin = '0';
		            span.style.padding = '0';
		            span.appendChild(this._document.createTextNode(SAMPLE_TEXT));
		            container.appendChild(span);
		            container.appendChild(img);
		            var baseline = img.offsetTop - span.offsetTop + 2;
		            container.removeChild(span);
		            container.appendChild(this._document.createTextNode(SAMPLE_TEXT));
		            container.style.lineHeight = 'normal';
		            img.style.verticalAlign = 'super';
		            var middle = img.offsetTop - container.offsetTop + 2;
		            body.removeChild(container);
		            return { baseline: baseline, middle: middle };
		        };
		        FontMetrics.prototype.getMetrics = function (fontFamily, fontSize) {
		            var key = fontFamily + " " + fontSize;
		            if (typeof this._data[key] === 'undefined') {
		                this._data[key] = this.parseMetrics(fontFamily, fontSize);
		            }
		            return this._data[key];
		        };
		        return FontMetrics;
		    }());

		    var Renderer = /** @class */ (function () {
		        function Renderer(context, options) {
		            this.context = context;
		            this.options = options;
		        }
		        return Renderer;
		    }());

		    var MASK_OFFSET = 10000;
		    var CanvasRenderer = /** @class */ (function (_super) {
		        __extends(CanvasRenderer, _super);
		        function CanvasRenderer(context, options) {
		            var _this = _super.call(this, context, options) || this;
		            _this._activeEffects = [];
		            _this.canvas = options.canvas ? options.canvas : document.createElement('canvas');
		            _this.ctx = _this.canvas.getContext('2d');
		            if (!options.canvas) {
		                _this.canvas.width = Math.floor(options.width * options.scale);
		                _this.canvas.height = Math.floor(options.height * options.scale);
		                _this.canvas.style.width = options.width + "px";
		                _this.canvas.style.height = options.height + "px";
		            }
		            _this.fontMetrics = new FontMetrics(document);
		            _this.ctx.scale(_this.options.scale, _this.options.scale);
		            _this.ctx.translate(-options.x, -options.y);
		            _this.ctx.textBaseline = 'bottom';
		            _this._activeEffects = [];
		            _this.context.logger.debug("Canvas renderer initialized (" + options.width + "x" + options.height + ") with scale " + options.scale);
		            return _this;
		        }
		        CanvasRenderer.prototype.applyEffects = function (effects) {
		            var _this = this;
		            while (this._activeEffects.length) {
		                this.popEffect();
		            }
		            effects.forEach(function (effect) { return _this.applyEffect(effect); });
		        };
		        CanvasRenderer.prototype.applyEffect = function (effect) {
		            this.ctx.save();
		            if (isOpacityEffect(effect)) {
		                this.ctx.globalAlpha = effect.opacity;
		            }
		            if (isTransformEffect(effect)) {
		                this.ctx.translate(effect.offsetX, effect.offsetY);
		                this.ctx.transform(effect.matrix[0], effect.matrix[1], effect.matrix[2], effect.matrix[3], effect.matrix[4], effect.matrix[5]);
		                this.ctx.translate(-effect.offsetX, -effect.offsetY);
		            }
		            if (isClipEffect(effect)) {
		                this.path(effect.path);
		                this.ctx.clip();
		            }
		            this._activeEffects.push(effect);
		        };
		        CanvasRenderer.prototype.popEffect = function () {
		            this._activeEffects.pop();
		            this.ctx.restore();
		        };
		        CanvasRenderer.prototype.renderStack = function (stack) {
		            return __awaiter(this, void 0, void 0, function () {
		                var styles;
		                return __generator(this, function (_a) {
		                    switch (_a.label) {
		                        case 0:
		                            styles = stack.element.container.styles;
		                            if (!styles.isVisible()) return [3 /*break*/, 2];
		                            return [4 /*yield*/, this.renderStackContent(stack)];
		                        case 1:
		                            _a.sent();
		                            _a.label = 2;
		                        case 2: return [2 /*return*/];
		                    }
		                });
		            });
		        };
		        CanvasRenderer.prototype.renderNode = function (paint) {
		            return __awaiter(this, void 0, void 0, function () {
		                return __generator(this, function (_a) {
		                    switch (_a.label) {
		                        case 0:
		                            if (contains(paint.container.flags, 16 /* DEBUG_RENDER */)) {
		                                debugger;
		                            }
		                            if (!paint.container.styles.isVisible()) return [3 /*break*/, 3];
		                            return [4 /*yield*/, this.renderNodeBackgroundAndBorders(paint)];
		                        case 1:
		                            _a.sent();
		                            return [4 /*yield*/, this.renderNodeContent(paint)];
		                        case 2:
		                            _a.sent();
		                            _a.label = 3;
		                        case 3: return [2 /*return*/];
		                    }
		                });
		            });
		        };
		        CanvasRenderer.prototype.renderTextWithLetterSpacing = function (text, letterSpacing, baseline) {
		            var _this = this;
		            if (letterSpacing === 0) {
		                this.ctx.fillText(text.text, text.bounds.left, text.bounds.top + baseline);
		            }
		            else {
		                var letters = segmentGraphemes(text.text);
		                letters.reduce(function (left, letter) {
		                    _this.ctx.fillText(letter, left, text.bounds.top + baseline);
		                    return left + _this.ctx.measureText(letter).width;
		                }, text.bounds.left);
		            }
		        };
		        CanvasRenderer.prototype.createFontStyle = function (styles) {
		            var fontVariant = styles.fontVariant
		                .filter(function (variant) { return variant === 'normal' || variant === 'small-caps'; })
		                .join('');
		            var fontFamily = fixIOSSystemFonts(styles.fontFamily).join(', ');
		            var fontSize = isDimensionToken(styles.fontSize)
		                ? "" + styles.fontSize.number + styles.fontSize.unit
		                : styles.fontSize.number + "px";
		            return [
		                [styles.fontStyle, fontVariant, styles.fontWeight, fontSize, fontFamily].join(' '),
		                fontFamily,
		                fontSize
		            ];
		        };
		        CanvasRenderer.prototype.renderTextNode = function (text, styles) {
		            return __awaiter(this, void 0, void 0, function () {
		                var _a, font, fontFamily, fontSize, _b, baseline, middle, paintOrder;
		                var _this = this;
		                return __generator(this, function (_c) {
		                    _a = this.createFontStyle(styles), font = _a[0], fontFamily = _a[1], fontSize = _a[2];
		                    this.ctx.font = font;
		                    this.ctx.direction = styles.direction === 1 /* RTL */ ? 'rtl' : 'ltr';
		                    this.ctx.textAlign = 'left';
		                    this.ctx.textBaseline = 'alphabetic';
		                    _b = this.fontMetrics.getMetrics(fontFamily, fontSize), baseline = _b.baseline, middle = _b.middle;
		                    paintOrder = styles.paintOrder;
		                    text.textBounds.forEach(function (text) {
		                        paintOrder.forEach(function (paintOrderLayer) {
		                            switch (paintOrderLayer) {
		                                case 0 /* FILL */:
		                                    _this.ctx.fillStyle = asString(styles.color);
		                                    _this.renderTextWithLetterSpacing(text, styles.letterSpacing, baseline);
		                                    var textShadows = styles.textShadow;
		                                    if (textShadows.length && text.text.trim().length) {
		                                        textShadows
		                                            .slice(0)
		                                            .reverse()
		                                            .forEach(function (textShadow) {
		                                            _this.ctx.shadowColor = asString(textShadow.color);
		                                            _this.ctx.shadowOffsetX = textShadow.offsetX.number * _this.options.scale;
		                                            _this.ctx.shadowOffsetY = textShadow.offsetY.number * _this.options.scale;
		                                            _this.ctx.shadowBlur = textShadow.blur.number;
		                                            _this.renderTextWithLetterSpacing(text, styles.letterSpacing, baseline);
		                                        });
		                                        _this.ctx.shadowColor = '';
		                                        _this.ctx.shadowOffsetX = 0;
		                                        _this.ctx.shadowOffsetY = 0;
		                                        _this.ctx.shadowBlur = 0;
		                                    }
		                                    if (styles.textDecorationLine.length) {
		                                        _this.ctx.fillStyle = asString(styles.textDecorationColor || styles.color);
		                                        styles.textDecorationLine.forEach(function (textDecorationLine) {
		                                            switch (textDecorationLine) {
		                                                case 1 /* UNDERLINE */:
		                                                    // Draws a line at the baseline of the font
		                                                    // TODO As some browsers display the line as more than 1px if the font-size is big,
		                                                    // need to take that into account both in position and size
		                                                    _this.ctx.fillRect(text.bounds.left, Math.round(text.bounds.top + baseline), text.bounds.width, 1);
		                                                    break;
		                                                case 2 /* OVERLINE */:
		                                                    _this.ctx.fillRect(text.bounds.left, Math.round(text.bounds.top), text.bounds.width, 1);
		                                                    break;
		                                                case 3 /* LINE_THROUGH */:
		                                                    // TODO try and find exact position for line-through
		                                                    _this.ctx.fillRect(text.bounds.left, Math.ceil(text.bounds.top + middle), text.bounds.width, 1);
		                                                    break;
		                                            }
		                                        });
		                                    }
		                                    break;
		                                case 1 /* STROKE */:
		                                    if (styles.webkitTextStrokeWidth && text.text.trim().length) {
		                                        _this.ctx.strokeStyle = asString(styles.webkitTextStrokeColor);
		                                        _this.ctx.lineWidth = styles.webkitTextStrokeWidth;
		                                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
		                                        _this.ctx.lineJoin = !!window.chrome ? 'miter' : 'round';
		                                        _this.ctx.strokeText(text.text, text.bounds.left, text.bounds.top + baseline);
		                                    }
		                                    _this.ctx.strokeStyle = '';
		                                    _this.ctx.lineWidth = 0;
		                                    _this.ctx.lineJoin = 'miter';
		                                    break;
		                            }
		                        });
		                    });
		                    return [2 /*return*/];
		                });
		            });
		        };
		        CanvasRenderer.prototype.renderReplacedElement = function (container, curves, image) {
		            if (image && container.intrinsicWidth > 0 && container.intrinsicHeight > 0) {
		                var box = contentBox(container);
		                var path = calculatePaddingBoxPath(curves);
		                this.path(path);
		                this.ctx.save();
		                this.ctx.clip();
		                this.ctx.drawImage(image, 0, 0, container.intrinsicWidth, container.intrinsicHeight, box.left, box.top, box.width, box.height);
		                this.ctx.restore();
		            }
		        };
		        CanvasRenderer.prototype.renderNodeContent = function (paint) {
		            return __awaiter(this, void 0, void 0, function () {
		                var container, curves, styles, _i, _a, child, image, image, iframeRenderer, canvas, size, _b, fontFamily, fontSize, baseline, bounds, x, textBounds, img, image, url, fontFamily, bounds;
		                return __generator(this, function (_c) {
		                    switch (_c.label) {
		                        case 0:
		                            this.applyEffects(paint.getEffects(4 /* CONTENT */));
		                            container = paint.container;
		                            curves = paint.curves;
		                            styles = container.styles;
		                            _i = 0, _a = container.textNodes;
		                            _c.label = 1;
		                        case 1:
		                            if (!(_i < _a.length)) return [3 /*break*/, 4];
		                            child = _a[_i];
		                            return [4 /*yield*/, this.renderTextNode(child, styles)];
		                        case 2:
		                            _c.sent();
		                            _c.label = 3;
		                        case 3:
		                            _i++;
		                            return [3 /*break*/, 1];
		                        case 4:
		                            if (!(container instanceof ImageElementContainer)) return [3 /*break*/, 8];
		                            _c.label = 5;
		                        case 5:
		                            _c.trys.push([5, 7, , 8]);
		                            return [4 /*yield*/, this.context.cache.match(container.src)];
		                        case 6:
		                            image = _c.sent();
		                            this.renderReplacedElement(container, curves, image);
		                            return [3 /*break*/, 8];
		                        case 7:
		                            _c.sent();
		                            this.context.logger.error("Error loading image " + container.src);
		                            return [3 /*break*/, 8];
		                        case 8:
		                            if (container instanceof CanvasElementContainer) {
		                                this.renderReplacedElement(container, curves, container.canvas);
		                            }
		                            if (!(container instanceof SVGElementContainer)) return [3 /*break*/, 12];
		                            _c.label = 9;
		                        case 9:
		                            _c.trys.push([9, 11, , 12]);
		                            return [4 /*yield*/, this.context.cache.match(container.svg)];
		                        case 10:
		                            image = _c.sent();
		                            this.renderReplacedElement(container, curves, image);
		                            return [3 /*break*/, 12];
		                        case 11:
		                            _c.sent();
		                            this.context.logger.error("Error loading svg " + container.svg.substring(0, 255));
		                            return [3 /*break*/, 12];
		                        case 12:
		                            if (!(container instanceof IFrameElementContainer && container.tree)) return [3 /*break*/, 14];
		                            iframeRenderer = new CanvasRenderer(this.context, {
		                                scale: this.options.scale,
		                                backgroundColor: container.backgroundColor,
		                                x: 0,
		                                y: 0,
		                                width: container.width,
		                                height: container.height
		                            });
		                            return [4 /*yield*/, iframeRenderer.render(container.tree)];
		                        case 13:
		                            canvas = _c.sent();
		                            if (container.width && container.height) {
		                                this.ctx.drawImage(canvas, 0, 0, container.width, container.height, container.bounds.left, container.bounds.top, container.bounds.width, container.bounds.height);
		                            }
		                            _c.label = 14;
		                        case 14:
		                            if (container instanceof InputElementContainer) {
		                                size = Math.min(container.bounds.width, container.bounds.height);
		                                if (container.type === CHECKBOX) {
		                                    if (container.checked) {
		                                        this.ctx.save();
		                                        this.path([
		                                            new Vector(container.bounds.left + size * 0.39363, container.bounds.top + size * 0.79),
		                                            new Vector(container.bounds.left + size * 0.16, container.bounds.top + size * 0.5549),
		                                            new Vector(container.bounds.left + size * 0.27347, container.bounds.top + size * 0.44071),
		                                            new Vector(container.bounds.left + size * 0.39694, container.bounds.top + size * 0.5649),
		                                            new Vector(container.bounds.left + size * 0.72983, container.bounds.top + size * 0.23),
		                                            new Vector(container.bounds.left + size * 0.84, container.bounds.top + size * 0.34085),
		                                            new Vector(container.bounds.left + size * 0.39363, container.bounds.top + size * 0.79)
		                                        ]);
		                                        this.ctx.fillStyle = asString(INPUT_COLOR);
		                                        this.ctx.fill();
		                                        this.ctx.restore();
		                                    }
		                                }
		                                else if (container.type === RADIO) {
		                                    if (container.checked) {
		                                        this.ctx.save();
		                                        this.ctx.beginPath();
		                                        this.ctx.arc(container.bounds.left + size / 2, container.bounds.top + size / 2, size / 4, 0, Math.PI * 2, true);
		                                        this.ctx.fillStyle = asString(INPUT_COLOR);
		                                        this.ctx.fill();
		                                        this.ctx.restore();
		                                    }
		                                }
		                            }
		                            if (isTextInputElement(container) && container.value.length) {
		                                _b = this.createFontStyle(styles), fontFamily = _b[0], fontSize = _b[1];
		                                baseline = this.fontMetrics.getMetrics(fontFamily, fontSize).baseline;
		                                this.ctx.font = fontFamily;
		                                this.ctx.fillStyle = asString(styles.color);
		                                this.ctx.textBaseline = 'alphabetic';
		                                this.ctx.textAlign = canvasTextAlign(container.styles.textAlign);
		                                bounds = contentBox(container);
		                                x = 0;
		                                switch (container.styles.textAlign) {
		                                    case 1 /* CENTER */:
		                                        x += bounds.width / 2;
		                                        break;
		                                    case 2 /* RIGHT */:
		                                        x += bounds.width;
		                                        break;
		                                }
		                                textBounds = bounds.add(x, 0, 0, -bounds.height / 2 + 1);
		                                this.ctx.save();
		                                this.path([
		                                    new Vector(bounds.left, bounds.top),
		                                    new Vector(bounds.left + bounds.width, bounds.top),
		                                    new Vector(bounds.left + bounds.width, bounds.top + bounds.height),
		                                    new Vector(bounds.left, bounds.top + bounds.height)
		                                ]);
		                                this.ctx.clip();
		                                this.renderTextWithLetterSpacing(new TextBounds(container.value, textBounds), styles.letterSpacing, baseline);
		                                this.ctx.restore();
		                                this.ctx.textBaseline = 'alphabetic';
		                                this.ctx.textAlign = 'left';
		                            }
		                            if (!contains(container.styles.display, 2048 /* LIST_ITEM */)) return [3 /*break*/, 20];
		                            if (!(container.styles.listStyleImage !== null)) return [3 /*break*/, 19];
		                            img = container.styles.listStyleImage;
		                            if (!(img.type === 0 /* URL */)) return [3 /*break*/, 18];
		                            image = void 0;
		                            url = img.url;
		                            _c.label = 15;
		                        case 15:
		                            _c.trys.push([15, 17, , 18]);
		                            return [4 /*yield*/, this.context.cache.match(url)];
		                        case 16:
		                            image = _c.sent();
		                            this.ctx.drawImage(image, container.bounds.left - (image.width + 10), container.bounds.top);
		                            return [3 /*break*/, 18];
		                        case 17:
		                            _c.sent();
		                            this.context.logger.error("Error loading list-style-image " + url);
		                            return [3 /*break*/, 18];
		                        case 18: return [3 /*break*/, 20];
		                        case 19:
		                            if (paint.listValue && container.styles.listStyleType !== -1 /* NONE */) {
		                                fontFamily = this.createFontStyle(styles)[0];
		                                this.ctx.font = fontFamily;
		                                this.ctx.fillStyle = asString(styles.color);
		                                this.ctx.textBaseline = 'middle';
		                                this.ctx.textAlign = 'right';
		                                bounds = new Bounds(container.bounds.left, container.bounds.top + getAbsoluteValue(container.styles.paddingTop, container.bounds.width), container.bounds.width, computeLineHeight(styles.lineHeight, styles.fontSize.number) / 2 + 1);
		                                this.renderTextWithLetterSpacing(new TextBounds(paint.listValue, bounds), styles.letterSpacing, computeLineHeight(styles.lineHeight, styles.fontSize.number) / 2 + 2);
		                                this.ctx.textBaseline = 'bottom';
		                                this.ctx.textAlign = 'left';
		                            }
		                            _c.label = 20;
		                        case 20: return [2 /*return*/];
		                    }
		                });
		            });
		        };
		        CanvasRenderer.prototype.renderStackContent = function (stack) {
		            return __awaiter(this, void 0, void 0, function () {
		                var _i, _a, child, _b, _c, child, _d, _e, child, _f, _g, child, _h, _j, child, _k, _l, child, _m, _o, child;
		                return __generator(this, function (_p) {
		                    switch (_p.label) {
		                        case 0:
		                            if (contains(stack.element.container.flags, 16 /* DEBUG_RENDER */)) {
		                                debugger;
		                            }
		                            // https://www.w3.org/TR/css-position-3/#painting-order
		                            // 1. the background and borders of the element forming the stacking context.
		                            return [4 /*yield*/, this.renderNodeBackgroundAndBorders(stack.element)];
		                        case 1:
		                            // https://www.w3.org/TR/css-position-3/#painting-order
		                            // 1. the background and borders of the element forming the stacking context.
		                            _p.sent();
		                            _i = 0, _a = stack.negativeZIndex;
		                            _p.label = 2;
		                        case 2:
		                            if (!(_i < _a.length)) return [3 /*break*/, 5];
		                            child = _a[_i];
		                            return [4 /*yield*/, this.renderStack(child)];
		                        case 3:
		                            _p.sent();
		                            _p.label = 4;
		                        case 4:
		                            _i++;
		                            return [3 /*break*/, 2];
		                        case 5: 
		                        // 3. For all its in-flow, non-positioned, block-level descendants in tree order:
		                        return [4 /*yield*/, this.renderNodeContent(stack.element)];
		                        case 6:
		                            // 3. For all its in-flow, non-positioned, block-level descendants in tree order:
		                            _p.sent();
		                            _b = 0, _c = stack.nonInlineLevel;
		                            _p.label = 7;
		                        case 7:
		                            if (!(_b < _c.length)) return [3 /*break*/, 10];
		                            child = _c[_b];
		                            return [4 /*yield*/, this.renderNode(child)];
		                        case 8:
		                            _p.sent();
		                            _p.label = 9;
		                        case 9:
		                            _b++;
		                            return [3 /*break*/, 7];
		                        case 10:
		                            _d = 0, _e = stack.nonPositionedFloats;
		                            _p.label = 11;
		                        case 11:
		                            if (!(_d < _e.length)) return [3 /*break*/, 14];
		                            child = _e[_d];
		                            return [4 /*yield*/, this.renderStack(child)];
		                        case 12:
		                            _p.sent();
		                            _p.label = 13;
		                        case 13:
		                            _d++;
		                            return [3 /*break*/, 11];
		                        case 14:
		                            _f = 0, _g = stack.nonPositionedInlineLevel;
		                            _p.label = 15;
		                        case 15:
		                            if (!(_f < _g.length)) return [3 /*break*/, 18];
		                            child = _g[_f];
		                            return [4 /*yield*/, this.renderStack(child)];
		                        case 16:
		                            _p.sent();
		                            _p.label = 17;
		                        case 17:
		                            _f++;
		                            return [3 /*break*/, 15];
		                        case 18:
		                            _h = 0, _j = stack.inlineLevel;
		                            _p.label = 19;
		                        case 19:
		                            if (!(_h < _j.length)) return [3 /*break*/, 22];
		                            child = _j[_h];
		                            return [4 /*yield*/, this.renderNode(child)];
		                        case 20:
		                            _p.sent();
		                            _p.label = 21;
		                        case 21:
		                            _h++;
		                            return [3 /*break*/, 19];
		                        case 22:
		                            _k = 0, _l = stack.zeroOrAutoZIndexOrTransformedOrOpacity;
		                            _p.label = 23;
		                        case 23:
		                            if (!(_k < _l.length)) return [3 /*break*/, 26];
		                            child = _l[_k];
		                            return [4 /*yield*/, this.renderStack(child)];
		                        case 24:
		                            _p.sent();
		                            _p.label = 25;
		                        case 25:
		                            _k++;
		                            return [3 /*break*/, 23];
		                        case 26:
		                            _m = 0, _o = stack.positiveZIndex;
		                            _p.label = 27;
		                        case 27:
		                            if (!(_m < _o.length)) return [3 /*break*/, 30];
		                            child = _o[_m];
		                            return [4 /*yield*/, this.renderStack(child)];
		                        case 28:
		                            _p.sent();
		                            _p.label = 29;
		                        case 29:
		                            _m++;
		                            return [3 /*break*/, 27];
		                        case 30: return [2 /*return*/];
		                    }
		                });
		            });
		        };
		        CanvasRenderer.prototype.mask = function (paths) {
		            this.ctx.beginPath();
		            this.ctx.moveTo(0, 0);
		            this.ctx.lineTo(this.canvas.width, 0);
		            this.ctx.lineTo(this.canvas.width, this.canvas.height);
		            this.ctx.lineTo(0, this.canvas.height);
		            this.ctx.lineTo(0, 0);
		            this.formatPath(paths.slice(0).reverse());
		            this.ctx.closePath();
		        };
		        CanvasRenderer.prototype.path = function (paths) {
		            this.ctx.beginPath();
		            this.formatPath(paths);
		            this.ctx.closePath();
		        };
		        CanvasRenderer.prototype.formatPath = function (paths) {
		            var _this = this;
		            paths.forEach(function (point, index) {
		                var start = isBezierCurve(point) ? point.start : point;
		                if (index === 0) {
		                    _this.ctx.moveTo(start.x, start.y);
		                }
		                else {
		                    _this.ctx.lineTo(start.x, start.y);
		                }
		                if (isBezierCurve(point)) {
		                    _this.ctx.bezierCurveTo(point.startControl.x, point.startControl.y, point.endControl.x, point.endControl.y, point.end.x, point.end.y);
		                }
		            });
		        };
		        CanvasRenderer.prototype.renderRepeat = function (path, pattern, offsetX, offsetY) {
		            this.path(path);
		            this.ctx.fillStyle = pattern;
		            this.ctx.translate(offsetX, offsetY);
		            this.ctx.fill();
		            this.ctx.translate(-offsetX, -offsetY);
		        };
		        CanvasRenderer.prototype.resizeImage = function (image, width, height) {
		            var _a;
		            if (image.width === width && image.height === height) {
		                return image;
		            }
		            var ownerDocument = (_a = this.canvas.ownerDocument) !== null && _a !== void 0 ? _a : document;
		            var canvas = ownerDocument.createElement('canvas');
		            canvas.width = Math.max(1, width);
		            canvas.height = Math.max(1, height);
		            var ctx = canvas.getContext('2d');
		            ctx.drawImage(image, 0, 0, image.width, image.height, 0, 0, width, height);
		            return canvas;
		        };
		        CanvasRenderer.prototype.renderBackgroundImage = function (container) {
		            return __awaiter(this, void 0, void 0, function () {
		                var index, _loop_1, this_1, _i, _a, backgroundImage;
		                return __generator(this, function (_b) {
		                    switch (_b.label) {
		                        case 0:
		                            index = container.styles.backgroundImage.length - 1;
		                            _loop_1 = function (backgroundImage) {
		                                var image, url, _c, path, x, y, width, height, pattern, _d, path, x, y, width, height, _e, lineLength, x0, x1, y0, y1, canvas, ctx, gradient_1, pattern, _f, path, left, top_1, width, height, position, x, y, _g, rx, ry, radialGradient_1, midX, midY, f, invF;
		                                return __generator(this, function (_h) {
		                                    switch (_h.label) {
		                                        case 0:
		                                            if (!(backgroundImage.type === 0 /* URL */)) return [3 /*break*/, 5];
		                                            image = void 0;
		                                            url = backgroundImage.url;
		                                            _h.label = 1;
		                                        case 1:
		                                            _h.trys.push([1, 3, , 4]);
		                                            return [4 /*yield*/, this_1.context.cache.match(url)];
		                                        case 2:
		                                            image = _h.sent();
		                                            return [3 /*break*/, 4];
		                                        case 3:
		                                            _h.sent();
		                                            this_1.context.logger.error("Error loading background-image " + url);
		                                            return [3 /*break*/, 4];
		                                        case 4:
		                                            if (image) {
		                                                _c = calculateBackgroundRendering(container, index, [
		                                                    image.width,
		                                                    image.height,
		                                                    image.width / image.height
		                                                ]), path = _c[0], x = _c[1], y = _c[2], width = _c[3], height = _c[4];
		                                                pattern = this_1.ctx.createPattern(this_1.resizeImage(image, width, height), 'repeat');
		                                                this_1.renderRepeat(path, pattern, x, y);
		                                            }
		                                            return [3 /*break*/, 6];
		                                        case 5:
		                                            if (isLinearGradient(backgroundImage)) {
		                                                _d = calculateBackgroundRendering(container, index, [null, null, null]), path = _d[0], x = _d[1], y = _d[2], width = _d[3], height = _d[4];
		                                                _e = calculateGradientDirection(backgroundImage.angle, width, height), lineLength = _e[0], x0 = _e[1], x1 = _e[2], y0 = _e[3], y1 = _e[4];
		                                                canvas = document.createElement('canvas');
		                                                canvas.width = width;
		                                                canvas.height = height;
		                                                ctx = canvas.getContext('2d');
		                                                gradient_1 = ctx.createLinearGradient(x0, y0, x1, y1);
		                                                processColorStops(backgroundImage.stops, lineLength).forEach(function (colorStop) {
		                                                    return gradient_1.addColorStop(colorStop.stop, asString(colorStop.color));
		                                                });
		                                                ctx.fillStyle = gradient_1;
		                                                ctx.fillRect(0, 0, width, height);
		                                                if (width > 0 && height > 0) {
		                                                    pattern = this_1.ctx.createPattern(canvas, 'repeat');
		                                                    this_1.renderRepeat(path, pattern, x, y);
		                                                }
		                                            }
		                                            else if (isRadialGradient(backgroundImage)) {
		                                                _f = calculateBackgroundRendering(container, index, [
		                                                    null,
		                                                    null,
		                                                    null
		                                                ]), path = _f[0], left = _f[1], top_1 = _f[2], width = _f[3], height = _f[4];
		                                                position = backgroundImage.position.length === 0 ? [FIFTY_PERCENT] : backgroundImage.position;
		                                                x = getAbsoluteValue(position[0], width);
		                                                y = getAbsoluteValue(position[position.length - 1], height);
		                                                _g = calculateRadius(backgroundImage, x, y, width, height), rx = _g[0], ry = _g[1];
		                                                if (rx > 0 && ry > 0) {
		                                                    radialGradient_1 = this_1.ctx.createRadialGradient(left + x, top_1 + y, 0, left + x, top_1 + y, rx);
		                                                    processColorStops(backgroundImage.stops, rx * 2).forEach(function (colorStop) {
		                                                        return radialGradient_1.addColorStop(colorStop.stop, asString(colorStop.color));
		                                                    });
		                                                    this_1.path(path);
		                                                    this_1.ctx.fillStyle = radialGradient_1;
		                                                    if (rx !== ry) {
		                                                        midX = container.bounds.left + 0.5 * container.bounds.width;
		                                                        midY = container.bounds.top + 0.5 * container.bounds.height;
		                                                        f = ry / rx;
		                                                        invF = 1 / f;
		                                                        this_1.ctx.save();
		                                                        this_1.ctx.translate(midX, midY);
		                                                        this_1.ctx.transform(1, 0, 0, f, 0, 0);
		                                                        this_1.ctx.translate(-midX, -midY);
		                                                        this_1.ctx.fillRect(left, invF * (top_1 - midY) + midY, width, height * invF);
		                                                        this_1.ctx.restore();
		                                                    }
		                                                    else {
		                                                        this_1.ctx.fill();
		                                                    }
		                                                }
		                                            }
		                                            _h.label = 6;
		                                        case 6:
		                                            index--;
		                                            return [2 /*return*/];
		                                    }
		                                });
		                            };
		                            this_1 = this;
		                            _i = 0, _a = container.styles.backgroundImage.slice(0).reverse();
		                            _b.label = 1;
		                        case 1:
		                            if (!(_i < _a.length)) return [3 /*break*/, 4];
		                            backgroundImage = _a[_i];
		                            return [5 /*yield**/, _loop_1(backgroundImage)];
		                        case 2:
		                            _b.sent();
		                            _b.label = 3;
		                        case 3:
		                            _i++;
		                            return [3 /*break*/, 1];
		                        case 4: return [2 /*return*/];
		                    }
		                });
		            });
		        };
		        CanvasRenderer.prototype.renderSolidBorder = function (color, side, curvePoints) {
		            return __awaiter(this, void 0, void 0, function () {
		                return __generator(this, function (_a) {
		                    this.path(parsePathForBorder(curvePoints, side));
		                    this.ctx.fillStyle = asString(color);
		                    this.ctx.fill();
		                    return [2 /*return*/];
		                });
		            });
		        };
		        CanvasRenderer.prototype.renderDoubleBorder = function (color, width, side, curvePoints) {
		            return __awaiter(this, void 0, void 0, function () {
		                var outerPaths, innerPaths;
		                return __generator(this, function (_a) {
		                    switch (_a.label) {
		                        case 0:
		                            if (!(width < 3)) return [3 /*break*/, 2];
		                            return [4 /*yield*/, this.renderSolidBorder(color, side, curvePoints)];
		                        case 1:
		                            _a.sent();
		                            return [2 /*return*/];
		                        case 2:
		                            outerPaths = parsePathForBorderDoubleOuter(curvePoints, side);
		                            this.path(outerPaths);
		                            this.ctx.fillStyle = asString(color);
		                            this.ctx.fill();
		                            innerPaths = parsePathForBorderDoubleInner(curvePoints, side);
		                            this.path(innerPaths);
		                            this.ctx.fill();
		                            return [2 /*return*/];
		                    }
		                });
		            });
		        };
		        CanvasRenderer.prototype.renderNodeBackgroundAndBorders = function (paint) {
		            return __awaiter(this, void 0, void 0, function () {
		                var styles, hasBackground, borders, backgroundPaintingArea, side, _i, borders_1, border;
		                var _this = this;
		                return __generator(this, function (_a) {
		                    switch (_a.label) {
		                        case 0:
		                            this.applyEffects(paint.getEffects(2 /* BACKGROUND_BORDERS */));
		                            styles = paint.container.styles;
		                            hasBackground = !isTransparent(styles.backgroundColor) || styles.backgroundImage.length;
		                            borders = [
		                                { style: styles.borderTopStyle, color: styles.borderTopColor, width: styles.borderTopWidth },
		                                { style: styles.borderRightStyle, color: styles.borderRightColor, width: styles.borderRightWidth },
		                                { style: styles.borderBottomStyle, color: styles.borderBottomColor, width: styles.borderBottomWidth },
		                                { style: styles.borderLeftStyle, color: styles.borderLeftColor, width: styles.borderLeftWidth }
		                            ];
		                            backgroundPaintingArea = calculateBackgroundCurvedPaintingArea(getBackgroundValueForIndex(styles.backgroundClip, 0), paint.curves);
		                            if (!(hasBackground || styles.boxShadow.length)) return [3 /*break*/, 2];
		                            this.ctx.save();
		                            this.path(backgroundPaintingArea);
		                            this.ctx.clip();
		                            if (!isTransparent(styles.backgroundColor)) {
		                                this.ctx.fillStyle = asString(styles.backgroundColor);
		                                this.ctx.fill();
		                            }
		                            return [4 /*yield*/, this.renderBackgroundImage(paint.container)];
		                        case 1:
		                            _a.sent();
		                            this.ctx.restore();
		                            styles.boxShadow
		                                .slice(0)
		                                .reverse()
		                                .forEach(function (shadow) {
		                                _this.ctx.save();
		                                var borderBoxArea = calculateBorderBoxPath(paint.curves);
		                                var maskOffset = shadow.inset ? 0 : MASK_OFFSET;
		                                var shadowPaintingArea = transformPath(borderBoxArea, -maskOffset + (shadow.inset ? 1 : -1) * shadow.spread.number, (shadow.inset ? 1 : -1) * shadow.spread.number, shadow.spread.number * (shadow.inset ? -2 : 2), shadow.spread.number * (shadow.inset ? -2 : 2));
		                                if (shadow.inset) {
		                                    _this.path(borderBoxArea);
		                                    _this.ctx.clip();
		                                    _this.mask(shadowPaintingArea);
		                                }
		                                else {
		                                    _this.mask(borderBoxArea);
		                                    _this.ctx.clip();
		                                    _this.path(shadowPaintingArea);
		                                }
		                                _this.ctx.shadowOffsetX = shadow.offsetX.number + maskOffset;
		                                _this.ctx.shadowOffsetY = shadow.offsetY.number;
		                                _this.ctx.shadowColor = asString(shadow.color);
		                                _this.ctx.shadowBlur = shadow.blur.number;
		                                _this.ctx.fillStyle = shadow.inset ? asString(shadow.color) : 'rgba(0,0,0,1)';
		                                _this.ctx.fill();
		                                _this.ctx.restore();
		                            });
		                            _a.label = 2;
		                        case 2:
		                            side = 0;
		                            _i = 0, borders_1 = borders;
		                            _a.label = 3;
		                        case 3:
		                            if (!(_i < borders_1.length)) return [3 /*break*/, 13];
		                            border = borders_1[_i];
		                            if (!(border.style !== 0 /* NONE */ && !isTransparent(border.color) && border.width > 0)) return [3 /*break*/, 11];
		                            if (!(border.style === 2 /* DASHED */)) return [3 /*break*/, 5];
		                            return [4 /*yield*/, this.renderDashedDottedBorder(border.color, border.width, side, paint.curves, 2 /* DASHED */)];
		                        case 4:
		                            _a.sent();
		                            return [3 /*break*/, 11];
		                        case 5:
		                            if (!(border.style === 3 /* DOTTED */)) return [3 /*break*/, 7];
		                            return [4 /*yield*/, this.renderDashedDottedBorder(border.color, border.width, side, paint.curves, 3 /* DOTTED */)];
		                        case 6:
		                            _a.sent();
		                            return [3 /*break*/, 11];
		                        case 7:
		                            if (!(border.style === 4 /* DOUBLE */)) return [3 /*break*/, 9];
		                            return [4 /*yield*/, this.renderDoubleBorder(border.color, border.width, side, paint.curves)];
		                        case 8:
		                            _a.sent();
		                            return [3 /*break*/, 11];
		                        case 9: return [4 /*yield*/, this.renderSolidBorder(border.color, side, paint.curves)];
		                        case 10:
		                            _a.sent();
		                            _a.label = 11;
		                        case 11:
		                            side++;
		                            _a.label = 12;
		                        case 12:
		                            _i++;
		                            return [3 /*break*/, 3];
		                        case 13: return [2 /*return*/];
		                    }
		                });
		            });
		        };
		        CanvasRenderer.prototype.renderDashedDottedBorder = function (color, width, side, curvePoints, style) {
		            return __awaiter(this, void 0, void 0, function () {
		                var strokePaths, boxPaths, startX, startY, endX, endY, length, dashLength, spaceLength, useLineDash, multiplier, numberOfDashes, minSpace, maxSpace, path1, path2, path1, path2;
		                return __generator(this, function (_a) {
		                    this.ctx.save();
		                    strokePaths = parsePathForBorderStroke(curvePoints, side);
		                    boxPaths = parsePathForBorder(curvePoints, side);
		                    if (style === 2 /* DASHED */) {
		                        this.path(boxPaths);
		                        this.ctx.clip();
		                    }
		                    if (isBezierCurve(boxPaths[0])) {
		                        startX = boxPaths[0].start.x;
		                        startY = boxPaths[0].start.y;
		                    }
		                    else {
		                        startX = boxPaths[0].x;
		                        startY = boxPaths[0].y;
		                    }
		                    if (isBezierCurve(boxPaths[1])) {
		                        endX = boxPaths[1].end.x;
		                        endY = boxPaths[1].end.y;
		                    }
		                    else {
		                        endX = boxPaths[1].x;
		                        endY = boxPaths[1].y;
		                    }
		                    if (side === 0 || side === 2) {
		                        length = Math.abs(startX - endX);
		                    }
		                    else {
		                        length = Math.abs(startY - endY);
		                    }
		                    this.ctx.beginPath();
		                    if (style === 3 /* DOTTED */) {
		                        this.formatPath(strokePaths);
		                    }
		                    else {
		                        this.formatPath(boxPaths.slice(0, 2));
		                    }
		                    dashLength = width < 3 ? width * 3 : width * 2;
		                    spaceLength = width < 3 ? width * 2 : width;
		                    if (style === 3 /* DOTTED */) {
		                        dashLength = width;
		                        spaceLength = width;
		                    }
		                    useLineDash = true;
		                    if (length <= dashLength * 2) {
		                        useLineDash = false;
		                    }
		                    else if (length <= dashLength * 2 + spaceLength) {
		                        multiplier = length / (2 * dashLength + spaceLength);
		                        dashLength *= multiplier;
		                        spaceLength *= multiplier;
		                    }
		                    else {
		                        numberOfDashes = Math.floor((length + spaceLength) / (dashLength + spaceLength));
		                        minSpace = (length - numberOfDashes * dashLength) / (numberOfDashes - 1);
		                        maxSpace = (length - (numberOfDashes + 1) * dashLength) / numberOfDashes;
		                        spaceLength =
		                            maxSpace <= 0 || Math.abs(spaceLength - minSpace) < Math.abs(spaceLength - maxSpace)
		                                ? minSpace
		                                : maxSpace;
		                    }
		                    if (useLineDash) {
		                        if (style === 3 /* DOTTED */) {
		                            this.ctx.setLineDash([0, dashLength + spaceLength]);
		                        }
		                        else {
		                            this.ctx.setLineDash([dashLength, spaceLength]);
		                        }
		                    }
		                    if (style === 3 /* DOTTED */) {
		                        this.ctx.lineCap = 'round';
		                        this.ctx.lineWidth = width;
		                    }
		                    else {
		                        this.ctx.lineWidth = width * 2 + 1.1;
		                    }
		                    this.ctx.strokeStyle = asString(color);
		                    this.ctx.stroke();
		                    this.ctx.setLineDash([]);
		                    // dashed round edge gap
		                    if (style === 2 /* DASHED */) {
		                        if (isBezierCurve(boxPaths[0])) {
		                            path1 = boxPaths[3];
		                            path2 = boxPaths[0];
		                            this.ctx.beginPath();
		                            this.formatPath([new Vector(path1.end.x, path1.end.y), new Vector(path2.start.x, path2.start.y)]);
		                            this.ctx.stroke();
		                        }
		                        if (isBezierCurve(boxPaths[1])) {
		                            path1 = boxPaths[1];
		                            path2 = boxPaths[2];
		                            this.ctx.beginPath();
		                            this.formatPath([new Vector(path1.end.x, path1.end.y), new Vector(path2.start.x, path2.start.y)]);
		                            this.ctx.stroke();
		                        }
		                    }
		                    this.ctx.restore();
		                    return [2 /*return*/];
		                });
		            });
		        };
		        CanvasRenderer.prototype.render = function (element) {
		            return __awaiter(this, void 0, void 0, function () {
		                var stack;
		                return __generator(this, function (_a) {
		                    switch (_a.label) {
		                        case 0:
		                            if (this.options.backgroundColor) {
		                                this.ctx.fillStyle = asString(this.options.backgroundColor);
		                                this.ctx.fillRect(this.options.x, this.options.y, this.options.width, this.options.height);
		                            }
		                            stack = parseStackingContexts(element);
		                            return [4 /*yield*/, this.renderStack(stack)];
		                        case 1:
		                            _a.sent();
		                            this.applyEffects([]);
		                            return [2 /*return*/, this.canvas];
		                    }
		                });
		            });
		        };
		        return CanvasRenderer;
		    }(Renderer));
		    var isTextInputElement = function (container) {
		        if (container instanceof TextareaElementContainer) {
		            return true;
		        }
		        else if (container instanceof SelectElementContainer) {
		            return true;
		        }
		        else if (container instanceof InputElementContainer && container.type !== RADIO && container.type !== CHECKBOX) {
		            return true;
		        }
		        return false;
		    };
		    var calculateBackgroundCurvedPaintingArea = function (clip, curves) {
		        switch (clip) {
		            case 0 /* BORDER_BOX */:
		                return calculateBorderBoxPath(curves);
		            case 2 /* CONTENT_BOX */:
		                return calculateContentBoxPath(curves);
		            case 1 /* PADDING_BOX */:
		            default:
		                return calculatePaddingBoxPath(curves);
		        }
		    };
		    var canvasTextAlign = function (textAlign) {
		        switch (textAlign) {
		            case 1 /* CENTER */:
		                return 'center';
		            case 2 /* RIGHT */:
		                return 'right';
		            case 0 /* LEFT */:
		            default:
		                return 'left';
		        }
		    };
		    // see https://github.com/niklasvh/html2canvas/pull/2645
		    var iOSBrokenFonts = ['-apple-system', 'system-ui'];
		    var fixIOSSystemFonts = function (fontFamilies) {
		        return /iPhone OS 15_(0|1)/.test(window.navigator.userAgent)
		            ? fontFamilies.filter(function (fontFamily) { return iOSBrokenFonts.indexOf(fontFamily) === -1; })
		            : fontFamilies;
		    };

		    var ForeignObjectRenderer = /** @class */ (function (_super) {
		        __extends(ForeignObjectRenderer, _super);
		        function ForeignObjectRenderer(context, options) {
		            var _this = _super.call(this, context, options) || this;
		            _this.canvas = options.canvas ? options.canvas : document.createElement('canvas');
		            _this.ctx = _this.canvas.getContext('2d');
		            _this.options = options;
		            _this.canvas.width = Math.floor(options.width * options.scale);
		            _this.canvas.height = Math.floor(options.height * options.scale);
		            _this.canvas.style.width = options.width + "px";
		            _this.canvas.style.height = options.height + "px";
		            _this.ctx.scale(_this.options.scale, _this.options.scale);
		            _this.ctx.translate(-options.x, -options.y);
		            _this.context.logger.debug("EXPERIMENTAL ForeignObject renderer initialized (" + options.width + "x" + options.height + " at " + options.x + "," + options.y + ") with scale " + options.scale);
		            return _this;
		        }
		        ForeignObjectRenderer.prototype.render = function (element) {
		            return __awaiter(this, void 0, void 0, function () {
		                var svg, img;
		                return __generator(this, function (_a) {
		                    switch (_a.label) {
		                        case 0:
		                            svg = createForeignObjectSVG(this.options.width * this.options.scale, this.options.height * this.options.scale, this.options.scale, this.options.scale, element);
		                            return [4 /*yield*/, loadSerializedSVG(svg)];
		                        case 1:
		                            img = _a.sent();
		                            if (this.options.backgroundColor) {
		                                this.ctx.fillStyle = asString(this.options.backgroundColor);
		                                this.ctx.fillRect(0, 0, this.options.width * this.options.scale, this.options.height * this.options.scale);
		                            }
		                            this.ctx.drawImage(img, -this.options.x * this.options.scale, -this.options.y * this.options.scale);
		                            return [2 /*return*/, this.canvas];
		                    }
		                });
		            });
		        };
		        return ForeignObjectRenderer;
		    }(Renderer));
		    var loadSerializedSVG = function (svg) {
		        return new Promise(function (resolve, reject) {
		            var img = new Image();
		            img.onload = function () {
		                resolve(img);
		            };
		            img.onerror = reject;
		            img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg));
		        });
		    };

		    var Logger = /** @class */ (function () {
		        function Logger(_a) {
		            var id = _a.id, enabled = _a.enabled;
		            this.id = id;
		            this.enabled = enabled;
		            this.start = Date.now();
		        }
		        // eslint-disable-next-line @typescript-eslint/no-explicit-any
		        Logger.prototype.debug = function () {
		            var args = [];
		            for (var _i = 0; _i < arguments.length; _i++) {
		                args[_i] = arguments[_i];
		            }
		            if (this.enabled) {
		                // eslint-disable-next-line no-console
		                if (typeof window !== 'undefined' && window.console && typeof console.debug === 'function') {
		                    // eslint-disable-next-line no-console
		                    console.debug.apply(console, __spreadArray([this.id, this.getTime() + "ms"], args));
		                }
		                else {
		                    this.info.apply(this, args);
		                }
		            }
		        };
		        Logger.prototype.getTime = function () {
		            return Date.now() - this.start;
		        };
		        // eslint-disable-next-line @typescript-eslint/no-explicit-any
		        Logger.prototype.info = function () {
		            var args = [];
		            for (var _i = 0; _i < arguments.length; _i++) {
		                args[_i] = arguments[_i];
		            }
		            if (this.enabled) {
		                // eslint-disable-next-line no-console
		                if (typeof window !== 'undefined' && window.console && typeof console.info === 'function') {
		                    // eslint-disable-next-line no-console
		                    console.info.apply(console, __spreadArray([this.id, this.getTime() + "ms"], args));
		                }
		            }
		        };
		        // eslint-disable-next-line @typescript-eslint/no-explicit-any
		        Logger.prototype.warn = function () {
		            var args = [];
		            for (var _i = 0; _i < arguments.length; _i++) {
		                args[_i] = arguments[_i];
		            }
		            if (this.enabled) {
		                // eslint-disable-next-line no-console
		                if (typeof window !== 'undefined' && window.console && typeof console.warn === 'function') {
		                    // eslint-disable-next-line no-console
		                    console.warn.apply(console, __spreadArray([this.id, this.getTime() + "ms"], args));
		                }
		                else {
		                    this.info.apply(this, args);
		                }
		            }
		        };
		        // eslint-disable-next-line @typescript-eslint/no-explicit-any
		        Logger.prototype.error = function () {
		            var args = [];
		            for (var _i = 0; _i < arguments.length; _i++) {
		                args[_i] = arguments[_i];
		            }
		            if (this.enabled) {
		                // eslint-disable-next-line no-console
		                if (typeof window !== 'undefined' && window.console && typeof console.error === 'function') {
		                    // eslint-disable-next-line no-console
		                    console.error.apply(console, __spreadArray([this.id, this.getTime() + "ms"], args));
		                }
		                else {
		                    this.info.apply(this, args);
		                }
		            }
		        };
		        Logger.instances = {};
		        return Logger;
		    }());

		    var Context = /** @class */ (function () {
		        function Context(options, windowBounds) {
		            var _a;
		            this.windowBounds = windowBounds;
		            this.instanceName = "#" + Context.instanceCount++;
		            this.logger = new Logger({ id: this.instanceName, enabled: options.logging });
		            this.cache = (_a = options.cache) !== null && _a !== void 0 ? _a : new Cache(this, options);
		        }
		        Context.instanceCount = 1;
		        return Context;
		    }());

		    var html2canvas = function (element, options) {
		        if (options === void 0) { options = {}; }
		        return renderElement(element, options);
		    };
		    if (typeof window !== 'undefined') {
		        CacheStorage.setContext(window);
		    }
		    var renderElement = function (element, opts) { return __awaiter(void 0, void 0, void 0, function () {
		        var ownerDocument, defaultView, resourceOptions, contextOptions, windowOptions, windowBounds, context, foreignObjectRendering, cloneOptions, documentCloner, clonedElement, container, _a, width, height, left, top, backgroundColor, renderOptions, canvas, renderer, root, renderer;
		        var _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t;
		        return __generator(this, function (_u) {
		            switch (_u.label) {
		                case 0:
		                    if (!element || typeof element !== 'object') {
		                        return [2 /*return*/, Promise.reject('Invalid element provided as first argument')];
		                    }
		                    ownerDocument = element.ownerDocument;
		                    if (!ownerDocument) {
		                        throw new Error("Element is not attached to a Document");
		                    }
		                    defaultView = ownerDocument.defaultView;
		                    if (!defaultView) {
		                        throw new Error("Document is not attached to a Window");
		                    }
		                    resourceOptions = {
		                        allowTaint: (_b = opts.allowTaint) !== null && _b !== void 0 ? _b : false,
		                        imageTimeout: (_c = opts.imageTimeout) !== null && _c !== void 0 ? _c : 15000,
		                        proxy: opts.proxy,
		                        useCORS: (_d = opts.useCORS) !== null && _d !== void 0 ? _d : false
		                    };
		                    contextOptions = __assign({ logging: (_e = opts.logging) !== null && _e !== void 0 ? _e : true, cache: opts.cache }, resourceOptions);
		                    windowOptions = {
		                        windowWidth: (_f = opts.windowWidth) !== null && _f !== void 0 ? _f : defaultView.innerWidth,
		                        windowHeight: (_g = opts.windowHeight) !== null && _g !== void 0 ? _g : defaultView.innerHeight,
		                        scrollX: (_h = opts.scrollX) !== null && _h !== void 0 ? _h : defaultView.pageXOffset,
		                        scrollY: (_j = opts.scrollY) !== null && _j !== void 0 ? _j : defaultView.pageYOffset
		                    };
		                    windowBounds = new Bounds(windowOptions.scrollX, windowOptions.scrollY, windowOptions.windowWidth, windowOptions.windowHeight);
		                    context = new Context(contextOptions, windowBounds);
		                    foreignObjectRendering = (_k = opts.foreignObjectRendering) !== null && _k !== void 0 ? _k : false;
		                    cloneOptions = {
		                        allowTaint: (_l = opts.allowTaint) !== null && _l !== void 0 ? _l : false,
		                        onclone: opts.onclone,
		                        ignoreElements: opts.ignoreElements,
		                        inlineImages: foreignObjectRendering,
		                        copyStyles: foreignObjectRendering
		                    };
		                    context.logger.debug("Starting document clone with size " + windowBounds.width + "x" + windowBounds.height + " scrolled to " + -windowBounds.left + "," + -windowBounds.top);
		                    documentCloner = new DocumentCloner(context, element, cloneOptions);
		                    clonedElement = documentCloner.clonedReferenceElement;
		                    if (!clonedElement) {
		                        return [2 /*return*/, Promise.reject("Unable to find element in cloned iframe")];
		                    }
		                    return [4 /*yield*/, documentCloner.toIFrame(ownerDocument, windowBounds)];
		                case 1:
		                    container = _u.sent();
		                    _a = isBodyElement(clonedElement) || isHTMLElement(clonedElement)
		                        ? parseDocumentSize(clonedElement.ownerDocument)
		                        : parseBounds(context, clonedElement), width = _a.width, height = _a.height, left = _a.left, top = _a.top;
		                    backgroundColor = parseBackgroundColor(context, clonedElement, opts.backgroundColor);
		                    renderOptions = {
		                        canvas: opts.canvas,
		                        backgroundColor: backgroundColor,
		                        scale: (_o = (_m = opts.scale) !== null && _m !== void 0 ? _m : defaultView.devicePixelRatio) !== null && _o !== void 0 ? _o : 1,
		                        x: ((_p = opts.x) !== null && _p !== void 0 ? _p : 0) + left,
		                        y: ((_q = opts.y) !== null && _q !== void 0 ? _q : 0) + top,
		                        width: (_r = opts.width) !== null && _r !== void 0 ? _r : Math.ceil(width),
		                        height: (_s = opts.height) !== null && _s !== void 0 ? _s : Math.ceil(height)
		                    };
		                    if (!foreignObjectRendering) return [3 /*break*/, 3];
		                    context.logger.debug("Document cloned, using foreign object rendering");
		                    renderer = new ForeignObjectRenderer(context, renderOptions);
		                    return [4 /*yield*/, renderer.render(clonedElement)];
		                case 2:
		                    canvas = _u.sent();
		                    return [3 /*break*/, 5];
		                case 3:
		                    context.logger.debug("Document cloned, element located at " + left + "," + top + " with size " + width + "x" + height + " using computed rendering");
		                    context.logger.debug("Starting DOM parsing");
		                    root = parseTree(context, clonedElement);
		                    if (backgroundColor === root.styles.backgroundColor) {
		                        root.styles.backgroundColor = COLORS.TRANSPARENT;
		                    }
		                    context.logger.debug("Starting renderer for element at " + renderOptions.x + "," + renderOptions.y + " with size " + renderOptions.width + "x" + renderOptions.height);
		                    renderer = new CanvasRenderer(context, renderOptions);
		                    return [4 /*yield*/, renderer.render(root)];
		                case 4:
		                    canvas = _u.sent();
		                    _u.label = 5;
		                case 5:
		                    if ((_t = opts.removeContainer) !== null && _t !== void 0 ? _t : true) {
		                        if (!DocumentCloner.destroy(container)) {
		                            context.logger.error("Cannot detach cloned iframe as it is not in the DOM anymore");
		                        }
		                    }
		                    context.logger.debug("Finished rendering");
		                    return [2 /*return*/, canvas];
		            }
		        });
		    }); };
		    var parseBackgroundColor = function (context, element, backgroundColorOverride) {
		        var ownerDocument = element.ownerDocument;
		        // http://www.w3.org/TR/css3-background/#special-backgrounds
		        var documentBackgroundColor = ownerDocument.documentElement
		            ? parseColor(context, getComputedStyle(ownerDocument.documentElement).backgroundColor)
		            : COLORS.TRANSPARENT;
		        var bodyBackgroundColor = ownerDocument.body
		            ? parseColor(context, getComputedStyle(ownerDocument.body).backgroundColor)
		            : COLORS.TRANSPARENT;
		        var defaultBackgroundColor = typeof backgroundColorOverride === 'string'
		            ? parseColor(context, backgroundColorOverride)
		            : backgroundColorOverride === null
		                ? COLORS.TRANSPARENT
		                : 0xffffffff;
		        return element === ownerDocument.documentElement
		            ? isTransparent(documentBackgroundColor)
		                ? isTransparent(bodyBackgroundColor)
		                    ? defaultBackgroundColor
		                    : bodyBackgroundColor
		                : documentBackgroundColor
		            : defaultBackgroundColor;
		    };

		    return html2canvas;

		})));
		
	} (html2canvas$2));
	return html2canvas$2.exports;
}

var html2canvasExports = requireHtml2canvas();
var html2canvas = /*@__PURE__*/getDefaultExportFromCjs(html2canvasExports);

/**
 * FingerprintJS v5.0.1 - Copyright (c) FingerprintJS, Inc, 2025 (https://fingerprint.com)
 *
 * Licensed under MIT License
 *
 * Copyright (c) 2025 FingerprintJS, Inc
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

var version = "5.0.1";

function wait(durationMs, resolveWith) {
    return new Promise((resolve) => setTimeout(resolve, durationMs, resolveWith));
}
/**
 * Allows asynchronous actions and microtasks to happen.
 */
function releaseEventLoop() {
    // Don't use setTimeout because Chrome throttles it in some cases causing very long agent execution:
    // https://stackoverflow.com/a/6032591/1118709
    // https://github.com/chromium/chromium/commit/0295dd09496330f3a9103ef7e543fa9b6050409b
    // Reusing a MessageChannel object gives no noticeable benefits
    return new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => resolve();
        channel.port2.postMessage(null);
    });
}
function requestIdleCallbackIfAvailable(fallbackTimeout, deadlineTimeout = Infinity) {
    const { requestIdleCallback } = window;
    if (requestIdleCallback) {
        // The function `requestIdleCallback` loses the binding to `window` here.
        // `globalThis` isn't always equal `window` (see https://github.com/fingerprintjs/fingerprintjs/issues/683).
        // Therefore, an error can occur. `call(window,` prevents the error.
        return new Promise((resolve) => requestIdleCallback.call(window, () => resolve(), { timeout: deadlineTimeout }));
    }
    else {
        return wait(Math.min(fallbackTimeout, deadlineTimeout));
    }
}
function isPromise(value) {
    return !!value && typeof value.then === 'function';
}
/**
 * Calls a maybe asynchronous function without creating microtasks when the function is synchronous.
 * Catches errors in both cases.
 *
 * If just you run a code like this:
 * ```
 * console.time('Action duration')
 * await action()
 * console.timeEnd('Action duration')
 * ```
 * The synchronous function time can be measured incorrectly because another microtask may run before the `await`
 * returns the control back to the code.
 */
function awaitIfAsync(action, callback) {
    try {
        const returnedValue = action();
        if (isPromise(returnedValue)) {
            returnedValue.then((result) => callback(true, result), (error) => callback(false, error));
        }
        else {
            callback(true, returnedValue);
        }
    }
    catch (error) {
        callback(false, error);
    }
}
/**
 * If you run many synchronous tasks without using this function, the JS main loop will be busy and asynchronous tasks
 * (e.g. completing a network request, rendering the page) won't be able to happen.
 * This function allows running many synchronous tasks such way that asynchronous tasks can run too in background.
 */
async function mapWithBreaks(items, callback, loopReleaseInterval = 16) {
    const results = Array(items.length);
    let lastLoopReleaseTime = Date.now();
    for (let i = 0; i < items.length; ++i) {
        results[i] = callback(items[i], i);
        const now = Date.now();
        if (now >= lastLoopReleaseTime + loopReleaseInterval) {
            lastLoopReleaseTime = now;
            await releaseEventLoop();
        }
    }
    return results;
}
/**
 * Makes the given promise never emit an unhandled promise rejection console warning.
 * The promise will still pass errors to the next promises.
 * Returns the input promise for convenience.
 *
 * Otherwise, promise emits a console warning unless it has a `catch` listener.
 */
function suppressUnhandledRejectionWarning(promise) {
    promise.then(undefined, () => undefined);
    return promise;
}

/*
 * This file contains functions to work with pure data only (no browser features, DOM, side effects, etc).
 */
/**
 * Does the same as Array.prototype.includes but has better typing
 */
function includes(haystack, needle) {
    for (let i = 0, l = haystack.length; i < l; ++i) {
        if (haystack[i] === needle) {
            return true;
        }
    }
    return false;
}
/**
 * Like `!includes()` but with proper typing
 */
function excludes(haystack, needle) {
    return !includes(haystack, needle);
}
/**
 * Be careful, NaN can return
 */
function toInt(value) {
    return parseInt(value);
}
/**
 * Be careful, NaN can return
 */
function toFloat(value) {
    return parseFloat(value);
}
function replaceNaN(value, replacement) {
    return typeof value === 'number' && isNaN(value) ? replacement : value;
}
function countTruthy(values) {
    return values.reduce((sum, value) => sum + (value ? 1 : 0), 0);
}
function round(value, base = 1) {
    if (Math.abs(base) >= 1) {
        return Math.round(value / base) * base;
    }
    else {
        // Sometimes when a number is multiplied by a small number, precision is lost,
        // for example 1234 * 0.0001 === 0.12340000000000001, and it's more precise divide: 1234 / (1 / 0.0001) === 0.1234.
        const counterBase = 1 / base;
        return Math.round(value * counterBase) / counterBase;
    }
}
/**
 * Parses a CSS selector into tag name with HTML attributes.
 * Only single element selector are supported (without operators like space, +, >, etc).
 *
 * Multiple values can be returned for each attribute. You decide how to handle them.
 */
function parseSimpleCssSelector(selector) {
    var _a, _b;
    const errorMessage = `Unexpected syntax '${selector}'`;
    const tagMatch = /^\s*([a-z-]*)(.*)$/i.exec(selector);
    const tag = tagMatch[1] || undefined;
    const attributes = {};
    const partsRegex = /([.:#][\w-]+|\[.+?\])/gi;
    const addAttribute = (name, value) => {
        attributes[name] = attributes[name] || [];
        attributes[name].push(value);
    };
    for (;;) {
        const match = partsRegex.exec(tagMatch[2]);
        if (!match) {
            break;
        }
        const part = match[0];
        switch (part[0]) {
            case '.':
                addAttribute('class', part.slice(1));
                break;
            case '#':
                addAttribute('id', part.slice(1));
                break;
            case '[': {
                const attributeMatch = /^\[([\w-]+)([~|^$*]?=("(.*?)"|([\w-]+)))?(\s+[is])?\]$/.exec(part);
                if (attributeMatch) {
                    addAttribute(attributeMatch[1], (_b = (_a = attributeMatch[4]) !== null && _a !== void 0 ? _a : attributeMatch[5]) !== null && _b !== void 0 ? _b : '');
                }
                else {
                    throw new Error(errorMessage);
                }
                break;
            }
            default:
                throw new Error(errorMessage);
        }
    }
    return [tag, attributes];
}
/**
 * Converts a string to UTF8 bytes
 */
function getUTF8Bytes(input) {
    // Benchmark: https://jsbench.me/b6klaaxgwq/1
    // If you want to just count bytes, see solutions at https://jsbench.me/ehklab415e/1
    const result = new Uint8Array(input.length);
    for (let i = 0; i < input.length; i++) {
        // `charCode` is faster than encoding, so we prefer that when it's possible
        const charCode = input.charCodeAt(i);
        // In case of non-ASCII symbols we use proper encoding
        if (charCode > 127) {
            return new TextEncoder().encode(input);
        }
        result[i] = charCode;
    }
    return result;
}

/*
 * Based on https://github.com/karanlyons/murmurHash3.js/blob/a33d0723127e2e5415056c455f8aed2451ace208/murmurHash3.js
 */
/**
 * Adds two 64-bit values (provided as tuples of 32-bit values)
 * and updates (mutates) first value to write the result
 */
function x64Add(m, n) {
    const m0 = m[0] >>> 16, m1 = m[0] & 0xffff, m2 = m[1] >>> 16, m3 = m[1] & 0xffff;
    const n0 = n[0] >>> 16, n1 = n[0] & 0xffff, n2 = n[1] >>> 16, n3 = n[1] & 0xffff;
    let o0 = 0, o1 = 0, o2 = 0, o3 = 0;
    o3 += m3 + n3;
    o2 += o3 >>> 16;
    o3 &= 0xffff;
    o2 += m2 + n2;
    o1 += o2 >>> 16;
    o2 &= 0xffff;
    o1 += m1 + n1;
    o0 += o1 >>> 16;
    o1 &= 0xffff;
    o0 += m0 + n0;
    o0 &= 0xffff;
    m[0] = (o0 << 16) | o1;
    m[1] = (o2 << 16) | o3;
}
/**
 * Multiplies two 64-bit values (provided as tuples of 32-bit values)
 * and updates (mutates) first value to write the result
 */
function x64Multiply(m, n) {
    const m0 = m[0] >>> 16, m1 = m[0] & 0xffff, m2 = m[1] >>> 16, m3 = m[1] & 0xffff;
    const n0 = n[0] >>> 16, n1 = n[0] & 0xffff, n2 = n[1] >>> 16, n3 = n[1] & 0xffff;
    let o0 = 0, o1 = 0, o2 = 0, o3 = 0;
    o3 += m3 * n3;
    o2 += o3 >>> 16;
    o3 &= 0xffff;
    o2 += m2 * n3;
    o1 += o2 >>> 16;
    o2 &= 0xffff;
    o2 += m3 * n2;
    o1 += o2 >>> 16;
    o2 &= 0xffff;
    o1 += m1 * n3;
    o0 += o1 >>> 16;
    o1 &= 0xffff;
    o1 += m2 * n2;
    o0 += o1 >>> 16;
    o1 &= 0xffff;
    o1 += m3 * n1;
    o0 += o1 >>> 16;
    o1 &= 0xffff;
    o0 += m0 * n3 + m1 * n2 + m2 * n1 + m3 * n0;
    o0 &= 0xffff;
    m[0] = (o0 << 16) | o1;
    m[1] = (o2 << 16) | o3;
}
/**
 * Provides left rotation of the given int64 value (provided as tuple of two int32)
 * by given number of bits. Result is written back to the value
 */
function x64Rotl(m, bits) {
    const m0 = m[0];
    bits %= 64;
    if (bits === 32) {
        m[0] = m[1];
        m[1] = m0;
    }
    else if (bits < 32) {
        m[0] = (m0 << bits) | (m[1] >>> (32 - bits));
        m[1] = (m[1] << bits) | (m0 >>> (32 - bits));
    }
    else {
        bits -= 32;
        m[0] = (m[1] << bits) | (m0 >>> (32 - bits));
        m[1] = (m0 << bits) | (m[1] >>> (32 - bits));
    }
}
/**
 * Provides a left shift of the given int32 value (provided as tuple of [0, int32])
 * by given number of bits. Result is written back to the value
 */
function x64LeftShift(m, bits) {
    bits %= 64;
    if (bits === 0) {
        return;
    }
    else if (bits < 32) {
        m[0] = m[1] >>> (32 - bits);
        m[1] = m[1] << bits;
    }
    else {
        m[0] = m[1] << (bits - 32);
        m[1] = 0;
    }
}
/**
 * Provides a XOR of the given int64 values(provided as tuple of two int32).
 * Result is written back to the first value
 */
function x64Xor(m, n) {
    m[0] ^= n[0];
    m[1] ^= n[1];
}
const F1 = [0xff51afd7, 0xed558ccd];
const F2 = [0xc4ceb9fe, 0x1a85ec53];
/**
 * Calculates murmurHash3's final x64 mix of that block and writes result back to the input value.
 * (`[0, h[0] >>> 1]` is a 33 bit unsigned right shift. This is the
 * only place where we need to right shift 64bit ints.)
 */
function x64Fmix(h) {
    const shifted = [0, h[0] >>> 1];
    x64Xor(h, shifted);
    x64Multiply(h, F1);
    shifted[1] = h[0] >>> 1;
    x64Xor(h, shifted);
    x64Multiply(h, F2);
    shifted[1] = h[0] >>> 1;
    x64Xor(h, shifted);
}
const C1 = [0x87c37b91, 0x114253d5];
const C2 = [0x4cf5ad43, 0x2745937f];
const M$1 = [0, 5];
const N1 = [0, 0x52dce729];
const N2 = [0, 0x38495ab5];
/**
 * Given a string and an optional seed as an int, returns a 128 bit
 * hash using the x64 flavor of MurmurHash3, as an unsigned hex.
 * All internal functions mutates passed value to achieve minimal memory allocations and GC load
 *
 * Benchmark https://jsbench.me/p4lkpaoabi/1
 */
function x64hash128(input, seed) {
    const key = getUTF8Bytes(input);
    seed = seed || 0;
    const length = [0, key.length];
    const remainder = length[1] % 16;
    const bytes = length[1] - remainder;
    const h1 = [0, seed];
    const h2 = [0, seed];
    const k1 = [0, 0];
    const k2 = [0, 0];
    let i;
    for (i = 0; i < bytes; i = i + 16) {
        k1[0] = key[i + 4] | (key[i + 5] << 8) | (key[i + 6] << 16) | (key[i + 7] << 24);
        k1[1] = key[i] | (key[i + 1] << 8) | (key[i + 2] << 16) | (key[i + 3] << 24);
        k2[0] = key[i + 12] | (key[i + 13] << 8) | (key[i + 14] << 16) | (key[i + 15] << 24);
        k2[1] = key[i + 8] | (key[i + 9] << 8) | (key[i + 10] << 16) | (key[i + 11] << 24);
        x64Multiply(k1, C1);
        x64Rotl(k1, 31);
        x64Multiply(k1, C2);
        x64Xor(h1, k1);
        x64Rotl(h1, 27);
        x64Add(h1, h2);
        x64Multiply(h1, M$1);
        x64Add(h1, N1);
        x64Multiply(k2, C2);
        x64Rotl(k2, 33);
        x64Multiply(k2, C1);
        x64Xor(h2, k2);
        x64Rotl(h2, 31);
        x64Add(h2, h1);
        x64Multiply(h2, M$1);
        x64Add(h2, N2);
    }
    k1[0] = 0;
    k1[1] = 0;
    k2[0] = 0;
    k2[1] = 0;
    const val = [0, 0];
    switch (remainder) {
        case 15:
            val[1] = key[i + 14];
            x64LeftShift(val, 48);
            x64Xor(k2, val);
        // fallthrough
        case 14:
            val[1] = key[i + 13];
            x64LeftShift(val, 40);
            x64Xor(k2, val);
        // fallthrough
        case 13:
            val[1] = key[i + 12];
            x64LeftShift(val, 32);
            x64Xor(k2, val);
        // fallthrough
        case 12:
            val[1] = key[i + 11];
            x64LeftShift(val, 24);
            x64Xor(k2, val);
        // fallthrough
        case 11:
            val[1] = key[i + 10];
            x64LeftShift(val, 16);
            x64Xor(k2, val);
        // fallthrough
        case 10:
            val[1] = key[i + 9];
            x64LeftShift(val, 8);
            x64Xor(k2, val);
        // fallthrough
        case 9:
            val[1] = key[i + 8];
            x64Xor(k2, val);
            x64Multiply(k2, C2);
            x64Rotl(k2, 33);
            x64Multiply(k2, C1);
            x64Xor(h2, k2);
        // fallthrough
        case 8:
            val[1] = key[i + 7];
            x64LeftShift(val, 56);
            x64Xor(k1, val);
        // fallthrough
        case 7:
            val[1] = key[i + 6];
            x64LeftShift(val, 48);
            x64Xor(k1, val);
        // fallthrough
        case 6:
            val[1] = key[i + 5];
            x64LeftShift(val, 40);
            x64Xor(k1, val);
        // fallthrough
        case 5:
            val[1] = key[i + 4];
            x64LeftShift(val, 32);
            x64Xor(k1, val);
        // fallthrough
        case 4:
            val[1] = key[i + 3];
            x64LeftShift(val, 24);
            x64Xor(k1, val);
        // fallthrough
        case 3:
            val[1] = key[i + 2];
            x64LeftShift(val, 16);
            x64Xor(k1, val);
        // fallthrough
        case 2:
            val[1] = key[i + 1];
            x64LeftShift(val, 8);
            x64Xor(k1, val);
        // fallthrough
        case 1:
            val[1] = key[i];
            x64Xor(k1, val);
            x64Multiply(k1, C1);
            x64Rotl(k1, 31);
            x64Multiply(k1, C2);
            x64Xor(h1, k1);
        // fallthrough
    }
    x64Xor(h1, length);
    x64Xor(h2, length);
    x64Add(h1, h2);
    x64Add(h2, h1);
    x64Fmix(h1);
    x64Fmix(h2);
    x64Add(h1, h2);
    x64Add(h2, h1);
    return (('00000000' + (h1[0] >>> 0).toString(16)).slice(-8) +
        ('00000000' + (h1[1] >>> 0).toString(16)).slice(-8) +
        ('00000000' + (h2[0] >>> 0).toString(16)).slice(-8) +
        ('00000000' + (h2[1] >>> 0).toString(16)).slice(-8));
}

/**
 * Converts an error object to a plain object that can be used with `JSON.stringify`.
 * If you just run `JSON.stringify(error)`, you'll get `'{}'`.
 */
function errorToObject(error) {
    var _a;
    return {
        name: error.name,
        message: error.message,
        stack: (_a = error.stack) === null || _a === void 0 ? void 0 : _a.split('\n'),
        // The fields are not enumerable, so TS is wrong saying that they will be overridden
        ...error,
    };
}
function isFunctionNative(func) {
    return /^function\s.*?\{\s*\[native code]\s*}$/.test(String(func));
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function isFinalResultLoaded(loadResult) {
    return typeof loadResult !== 'function';
}
/**
 * Loads the given entropy source. Returns a function that gets an entropy component from the source.
 *
 * The result is returned synchronously to prevent `loadSources` from
 * waiting for one source to load before getting the components from the other sources.
 */
function loadSource(source, sourceOptions) {
    const sourceLoadPromise = suppressUnhandledRejectionWarning(new Promise((resolveLoad) => {
        const loadStartTime = Date.now();
        // `awaitIfAsync` is used instead of just `await` in order to measure the duration of synchronous sources
        // correctly (other microtasks won't affect the duration).
        awaitIfAsync(source.bind(null, sourceOptions), (...loadArgs) => {
            const loadDuration = Date.now() - loadStartTime;
            // Source loading failed
            if (!loadArgs[0]) {
                return resolveLoad(() => ({ error: loadArgs[1], duration: loadDuration }));
            }
            const loadResult = loadArgs[1];
            // Source loaded with the final result
            if (isFinalResultLoaded(loadResult)) {
                return resolveLoad(() => ({ value: loadResult, duration: loadDuration }));
            }
            // Source loaded with "get" stage
            resolveLoad(() => new Promise((resolveGet) => {
                const getStartTime = Date.now();
                awaitIfAsync(loadResult, (...getArgs) => {
                    const duration = loadDuration + Date.now() - getStartTime;
                    // Source getting failed
                    if (!getArgs[0]) {
                        return resolveGet({ error: getArgs[1], duration });
                    }
                    // Source getting succeeded
                    resolveGet({ value: getArgs[1], duration });
                });
            }));
        });
    }));
    return function getComponent() {
        return sourceLoadPromise.then((finalizeSource) => finalizeSource());
    };
}
/**
 * Loads the given entropy sources. Returns a function that collects the entropy components.
 *
 * The result is returned synchronously in order to allow start getting the components
 * before the sources are loaded completely.
 *
 * Warning for package users:
 * This function is out of Semantic Versioning, i.e. can change unexpectedly. Usage is at your own risk.
 */
function loadSources(sources, sourceOptions, excludeSources, loopReleaseInterval) {
    const includedSources = Object.keys(sources).filter((sourceKey) => excludes(excludeSources, sourceKey));
    // Using `mapWithBreaks` allows asynchronous sources to complete between synchronous sources
    // and measure the duration correctly
    const sourceGettersPromise = suppressUnhandledRejectionWarning(mapWithBreaks(includedSources, (sourceKey) => loadSource(sources[sourceKey], sourceOptions), loopReleaseInterval));
    return async function getComponents() {
        const sourceGetters = await sourceGettersPromise;
        const componentPromises = await mapWithBreaks(sourceGetters, (sourceGetter) => suppressUnhandledRejectionWarning(sourceGetter()), loopReleaseInterval);
        const componentArray = await Promise.all(componentPromises);
        // Keeping the component keys order the same as the source keys order
        const components = {};
        for (let index = 0; index < includedSources.length; ++index) {
            components[includedSources[index]] = componentArray[index];
        }
        return components;
    };
}

/*
 * Functions to help with features that vary through browsers
 */
/**
 * Checks whether the browser is based on Trident (the Internet Explorer engine) without using user-agent.
 *
 * Warning for package users:
 * This function is out of Semantic Versioning, i.e. can change unexpectedly. Usage is at your own risk.
 */
function isTrident() {
    const w = window;
    const n = navigator;
    // The properties are checked to be in IE 10, IE 11 and not to be in other browsers in October 2020
    return (countTruthy([
        'MSCSSMatrix' in w,
        'msSetImmediate' in w,
        'msIndexedDB' in w,
        'msMaxTouchPoints' in n,
        'msPointerEnabled' in n,
    ]) >= 4);
}
/**
 * Checks whether the browser is based on EdgeHTML (the pre-Chromium Edge engine) without using user-agent.
 *
 * Warning for package users:
 * This function is out of Semantic Versioning, i.e. can change unexpectedly. Usage is at your own risk.
 */
function isEdgeHTML() {
    // Based on research in October 2020
    const w = window;
    const n = navigator;
    return (countTruthy(['msWriteProfilerMark' in w, 'MSStream' in w, 'msLaunchUri' in n, 'msSaveBlob' in n]) >= 3 &&
        !isTrident());
}
/**
 * Checks whether the browser is based on Chromium without using user-agent.
 *
 * Warning for package users:
 * This function is out of Semantic Versioning, i.e. can change unexpectedly. Usage is at your own risk.
 */
function isChromium() {
    // Based on research in October 2020. Tested to detect Chromium 42-86.
    const w = window;
    const n = navigator;
    return (countTruthy([
        'webkitPersistentStorage' in n,
        'webkitTemporaryStorage' in n,
        (n.vendor || '').indexOf('Google') === 0,
        'webkitResolveLocalFileSystemURL' in w,
        'BatteryManager' in w,
        'webkitMediaStream' in w,
        'webkitSpeechGrammar' in w,
    ]) >= 5);
}
/**
 * Checks whether the browser is based on mobile or desktop Safari without using user-agent.
 * All iOS browsers use WebKit (the Safari engine).
 *
 * Warning for package users:
 * This function is out of Semantic Versioning, i.e. can change unexpectedly. Usage is at your own risk.
 */
function isWebKit() {
    // Based on research in August 2024
    const w = window;
    const n = navigator;
    return (countTruthy([
        'ApplePayError' in w,
        'CSSPrimitiveValue' in w,
        'Counter' in w,
        n.vendor.indexOf('Apple') === 0,
        'RGBColor' in w,
        'WebKitMediaKeys' in w,
    ]) >= 4);
}
/**
 * Checks whether this WebKit browser is a desktop browser.
 * It doesn't check that the browser is based on WebKit, there is a separate function for this.
 *
 * Warning for package users:
 * This function is out of Semantic Versioning, i.e. can change unexpectedly. Usage is at your own risk.
 */
function isDesktopWebKit() {
    // Checked in Safari and DuckDuckGo
    const w = window;
    const { HTMLElement, Document } = w;
    return (countTruthy([
        'safari' in w,
        !('ongestureend' in w),
        !('TouchEvent' in w),
        !('orientation' in w),
        HTMLElement && !('autocapitalize' in HTMLElement.prototype),
        Document && 'pointerLockElement' in Document.prototype,
    ]) >= 4);
}
/**
 * Checks whether this WebKit browser is Safari.
 * It doesn't check that the browser is based on WebKit, there is a separate function for this.
 *
 * Warning! The function works properly only for Safari version 15.4 and newer.
 */
function isSafariWebKit() {
    // Checked in Safari, Chrome, Firefox, Yandex, UC Browser, Opera, Edge and DuckDuckGo.
    // iOS Safari and Chrome were checked on iOS 11-18. DuckDuckGo was checked on iOS 17-18 and macOS 14-15.
    // Desktop Safari versions 12-18 were checked.
    // The other browsers were checked on iOS 17 and 18; there was no chance to check them on the other OS versions.
    const w = window;
    return (
    // Filters-out Chrome, Yandex, DuckDuckGo (macOS and iOS), Edge
    isFunctionNative(w.print) &&
        // Doesn't work in Safari < 15.4
        String(w.browser) === '[object WebPageNamespace]');
}
/**
 * Checks whether the browser is based on Gecko (Firefox engine) without using user-agent.
 *
 * Warning for package users:
 * This function is out of Semantic Versioning, i.e. can change unexpectedly. Usage is at your own risk.
 */
function isGecko() {
    var _a, _b;
    const w = window;
    // Based on research in September 2020
    return (countTruthy([
        'buildID' in navigator,
        'MozAppearance' in ((_b = (_a = document.documentElement) === null || _a === void 0 ? void 0 : _a.style) !== null && _b !== void 0 ? _b : {}),
        'onmozfullscreenchange' in w,
        'mozInnerScreenX' in w,
        'CSSMozDocumentRule' in w,
        'CanvasCaptureMediaStream' in w,
    ]) >= 4);
}
/**
 * Checks whether the browser is based on Chromium version ≥86 without using user-agent.
 * It doesn't check that the browser is based on Chromium, there is a separate function for this.
 */
function isChromium86OrNewer() {
    // Checked in Chrome 85 vs Chrome 86 both on desktop and Android. Checked in macOS Chrome 128, Android Chrome 127.
    const w = window;
    return (countTruthy([
        !('MediaSettingsRange' in w),
        'RTCEncodedAudioFrame' in w,
        '' + w.Intl === '[object Intl]',
        '' + w.Reflect === '[object Reflect]',
    ]) >= 3);
}
/**
 * Checks whether the browser is based on Chromium version ≥122 without using user-agent.
 * It doesn't check that the browser is based on Chromium, there is a separate function for this.
 */
function isChromium122OrNewer() {
    // Checked in Chrome 121 vs Chrome 122 and 129 both on desktop and Android
    const w = window;
    const { URLPattern } = w;
    return (countTruthy([
        'union' in Set.prototype,
        'Iterator' in w,
        URLPattern && 'hasRegExpGroups' in URLPattern.prototype,
        'RGB8' in WebGLRenderingContext.prototype,
    ]) >= 3);
}
/**
 * Checks whether the browser is based on WebKit version ≥606 (Safari ≥12) without using user-agent.
 * It doesn't check that the browser is based on WebKit, there is a separate function for this.
 *
 * @see https://en.wikipedia.org/wiki/Safari_version_history#Release_history Safari-WebKit versions map
 */
function isWebKit606OrNewer() {
    // Checked in Safari 9–18
    const w = window;
    return (countTruthy([
        'DOMRectList' in w,
        'RTCPeerConnectionIceEvent' in w,
        'SVGGeometryElement' in w,
        'ontransitioncancel' in w,
    ]) >= 3);
}
/**
 * Checks whether the browser is based on WebKit version ≥616 (Safari ≥17) without using user-agent.
 * It doesn't check that the browser is based on WebKit, there is a separate function for this.
 *
 * @see https://developer.apple.com/documentation/safari-release-notes/safari-17-release-notes Safari 17 release notes
 * @see https://tauri.app/v1/references/webview-versions/#webkit-versions-in-safari Safari-WebKit versions map
 */
function isWebKit616OrNewer() {
    const w = window;
    const n = navigator;
    const { CSS, HTMLButtonElement } = w;
    return (countTruthy([
        !('getStorageUpdates' in n),
        HTMLButtonElement && 'popover' in HTMLButtonElement.prototype,
        'CSSCounterStyleRule' in w,
        CSS.supports('font-size-adjust: ex-height 0.5'),
        CSS.supports('text-transform: full-width'),
    ]) >= 4);
}
/**
 * Checks whether the device is an iPad.
 * It doesn't check that the engine is WebKit and that the WebKit isn't desktop.
 */
function isIPad() {
    // Checked on:
    // Safari on iPadOS (both mobile and desktop modes): 8, 11-18
    // Chrome on iPadOS (both mobile and desktop modes): 11-18
    // Safari on iOS (both mobile and desktop modes): 9-18
    // Chrome on iOS (both mobile and desktop modes): 9-18
    // Before iOS 13. Safari tampers the value in "request desktop site" mode since iOS 13.
    if (navigator.platform === 'iPad') {
        return true;
    }
    const s = screen;
    const screenRatio = s.width / s.height;
    return (countTruthy([
        // Since iOS 13. Doesn't work in Chrome on iPadOS <15, but works in desktop mode.
        'MediaSource' in window,
        // Since iOS 12. Doesn't work in Chrome on iPadOS.
        !!Element.prototype.webkitRequestFullscreen,
        // iPhone 4S that runs iOS 9 matches this, but it is not supported
        // Doesn't work in incognito mode of Safari ≥17 with split screen because of tracking prevention
        screenRatio > 0.65 && screenRatio < 1.53,
    ]) >= 2);
}
/**
 * Warning for package users:
 * This function is out of Semantic Versioning, i.e. can change unexpectedly. Usage is at your own risk.
 */
function getFullscreenElement() {
    const d = document;
    return d.fullscreenElement || d.msFullscreenElement || d.mozFullScreenElement || d.webkitFullscreenElement || null;
}
function exitFullscreen() {
    const d = document;
    // `call` is required because the function throws an error without a proper "this" context
    return (d.exitFullscreen || d.msExitFullscreen || d.mozCancelFullScreen || d.webkitExitFullscreen).call(d);
}
/**
 * Checks whether the device runs on Android without using user-agent.
 *
 * Warning for package users:
 * This function is out of Semantic Versioning, i.e. can change unexpectedly. Usage is at your own risk.
 */
function isAndroid() {
    const isItChromium = isChromium();
    const isItGecko = isGecko();
    const w = window;
    const n = navigator;
    const c = 'connection';
    // Chrome removes all words "Android" from `navigator` when desktop version is requested
    // Firefox keeps "Android" in `navigator.appVersion` when desktop version is requested
    if (isItChromium) {
        return (countTruthy([
            !('SharedWorker' in w),
            // `typechange` is deprecated, but it's still present on Android (tested on Chrome Mobile 117)
            // Removal proposal https://bugs.chromium.org/p/chromium/issues/detail?id=699892
            // Note: this expression returns true on ChromeOS, so additional detectors are required to avoid false-positives
            n[c] && 'ontypechange' in n[c],
            !('sinkId' in new Audio()),
        ]) >= 2);
    }
    else if (isItGecko) {
        return countTruthy(['onorientationchange' in w, 'orientation' in w, /android/i.test(n.appVersion)]) >= 2;
    }
    else {
        // Only 2 browser engines are presented on Android.
        // Actually, there is also Android 4.1 browser, but it's not worth detecting it at the moment.
        return false;
    }
}
/**
 * Checks whether the browser is Samsung Internet without using user-agent.
 * It doesn't check that the browser is based on Chromium, please use `isChromium` before using this function.
 *
 * Warning for package users:
 * This function is out of Semantic Versioning, i.e. can change unexpectedly. Usage is at your own risk.
 */
function isSamsungInternet() {
    // Checked in Samsung Internet 21, 25 and 27
    const n = navigator;
    const w = window;
    const audioPrototype = Audio.prototype;
    const { visualViewport } = w;
    return (countTruthy([
        'srLatency' in audioPrototype,
        'srChannelCount' in audioPrototype,
        'devicePosture' in n,
        visualViewport && 'segments' in visualViewport,
        'getTextInformation' in Image.prototype, // Not available in Samsung Internet 21
    ]) >= 3);
}

/**
 * A deep description: https://fingerprint.com/blog/audio-fingerprinting/
 * Inspired by and based on https://github.com/cozylife/audio-fingerprint
 *
 * A version of the entropy source with stabilization to make it suitable for static fingerprinting.
 * Audio signal is noised in private mode of Safari 17, so audio fingerprinting is skipped in Safari 17.
 */
function getAudioFingerprint() {
    if (doesBrowserPerformAntifingerprinting$1()) {
        return -4 /* SpecialFingerprint.KnownForAntifingerprinting */;
    }
    return getUnstableAudioFingerprint();
}
/**
 * A version of the entropy source without stabilization.
 *
 * Warning for package users:
 * This function is out of Semantic Versioning, i.e. can change unexpectedly. Usage is at your own risk.
 */
function getUnstableAudioFingerprint() {
    const w = window;
    const AudioContext = w.OfflineAudioContext || w.webkitOfflineAudioContext;
    if (!AudioContext) {
        return -2 /* SpecialFingerprint.NotSupported */;
    }
    // In some browsers, audio context always stays suspended unless the context is started in response to a user action
    // (e.g. a click or a tap). It prevents audio fingerprint from being taken at an arbitrary moment of time.
    // Such browsers are old and unpopular, so the audio fingerprinting is just skipped in them.
    // See a similar case explanation at https://stackoverflow.com/questions/46363048/onaudioprocess-not-called-on-ios11#46534088
    if (doesBrowserSuspendAudioContext()) {
        return -1 /* SpecialFingerprint.KnownForSuspending */;
    }
    const hashFromIndex = 4500;
    const hashToIndex = 5000;
    const context = new AudioContext(1, hashToIndex, 44100);
    const oscillator = context.createOscillator();
    oscillator.type = 'triangle';
    oscillator.frequency.value = 10000;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -50;
    compressor.knee.value = 40;
    compressor.ratio.value = 12;
    compressor.attack.value = 0;
    compressor.release.value = 0.25;
    oscillator.connect(compressor);
    compressor.connect(context.destination);
    oscillator.start(0);
    const [renderPromise, finishRendering] = startRenderingAudio(context);
    // Suppresses the console error message in case when the fingerprint fails before requested
    const fingerprintPromise = suppressUnhandledRejectionWarning(renderPromise.then((buffer) => getHash(buffer.getChannelData(0).subarray(hashFromIndex)), (error) => {
        if (error.name === "timeout" /* InnerErrorName.Timeout */ || error.name === "suspended" /* InnerErrorName.Suspended */) {
            return -3 /* SpecialFingerprint.Timeout */;
        }
        throw error;
    }));
    return () => {
        finishRendering();
        return fingerprintPromise;
    };
}
/**
 * Checks if the current browser is known for always suspending audio context
 */
function doesBrowserSuspendAudioContext() {
    // Mobile Safari 11 and older
    return isWebKit() && !isDesktopWebKit() && !isWebKit606OrNewer();
}
/**
 * Checks if the current browser is known for applying anti-fingerprinting measures in all or some critical modes
 */
function doesBrowserPerformAntifingerprinting$1() {
    return (
    // Safari ≥17
    (isWebKit() && isWebKit616OrNewer() && isSafariWebKit()) ||
        // Samsung Internet ≥26
        (isChromium() && isSamsungInternet() && isChromium122OrNewer()));
}
/**
 * Starts rendering the audio context.
 * When the returned function is called, the render process starts finishing.
 */
function startRenderingAudio(context) {
    const renderTryMaxCount = 3;
    const renderRetryDelay = 500;
    const runningMaxAwaitTime = 500;
    const runningSufficientTime = 5000;
    let finalize = () => undefined;
    const resultPromise = new Promise((resolve, reject) => {
        let isFinalized = false;
        let renderTryCount = 0;
        let startedRunningAt = 0;
        context.oncomplete = (event) => resolve(event.renderedBuffer);
        const startRunningTimeout = () => {
            setTimeout(() => reject(makeInnerError("timeout" /* InnerErrorName.Timeout */)), Math.min(runningMaxAwaitTime, startedRunningAt + runningSufficientTime - Date.now()));
        };
        const tryRender = () => {
            try {
                const renderingPromise = context.startRendering();
                // `context.startRendering` has two APIs: Promise and callback, we check that it's really a promise just in case
                if (isPromise(renderingPromise)) {
                    // Suppresses all unhandled rejections in case of scheduled redundant retries after successful rendering
                    suppressUnhandledRejectionWarning(renderingPromise);
                }
                switch (context.state) {
                    case 'running':
                        startedRunningAt = Date.now();
                        if (isFinalized) {
                            startRunningTimeout();
                        }
                        break;
                    // Sometimes the audio context doesn't start after calling `startRendering` (in addition to the cases where
                    // audio context doesn't start at all). A known case is starting an audio context when the browser tab is in
                    // background on iPhone. Retries usually help in this case.
                    case 'suspended':
                        // The audio context can reject starting until the tab is in foreground. Long fingerprint duration
                        // in background isn't a problem, therefore the retry attempts don't count in background. It can lead to
                        // a situation when a fingerprint takes very long time and finishes successfully. FYI, the audio context
                        // can be suspended when `document.hidden === false` and start running after a retry.
                        if (!document.hidden) {
                            renderTryCount++;
                        }
                        if (isFinalized && renderTryCount >= renderTryMaxCount) {
                            reject(makeInnerError("suspended" /* InnerErrorName.Suspended */));
                        }
                        else {
                            setTimeout(tryRender, renderRetryDelay);
                        }
                        break;
                }
            }
            catch (error) {
                reject(error);
            }
        };
        tryRender();
        finalize = () => {
            if (!isFinalized) {
                isFinalized = true;
                if (startedRunningAt > 0) {
                    startRunningTimeout();
                }
            }
        };
    });
    return [resultPromise, finalize];
}
function getHash(signal) {
    let hash = 0;
    for (let i = 0; i < signal.length; ++i) {
        hash += Math.abs(signal[i]);
    }
    return hash;
}
function makeInnerError(name) {
    const error = new Error(name);
    error.name = name;
    return error;
}

/**
 * Creates and keeps an invisible iframe while the given function runs.
 * The given function is called when the iframe is loaded and has a body.
 * The iframe allows to measure DOM sizes inside itself.
 *
 * Notice: passing an initial HTML code doesn't work in IE.
 *
 * Warning for package users:
 * This function is out of Semantic Versioning, i.e. can change unexpectedly. Usage is at your own risk.
 */
async function withIframe(action, initialHtml, domPollInterval = 50) {
    var _a, _b, _c;
    const d = document;
    // document.body can be null while the page is loading
    while (!d.body) {
        await wait(domPollInterval);
    }
    const iframe = d.createElement('iframe');
    try {
        await new Promise((_resolve, _reject) => {
            let isComplete = false;
            const resolve = () => {
                isComplete = true;
                _resolve();
            };
            const reject = (error) => {
                isComplete = true;
                _reject(error);
            };
            iframe.onload = resolve;
            iframe.onerror = reject;
            const { style } = iframe;
            style.setProperty('display', 'block', 'important'); // Required for browsers to calculate the layout
            style.position = 'absolute';
            style.top = '0';
            style.left = '0';
            style.visibility = 'hidden';
            if (initialHtml && 'srcdoc' in iframe) {
                iframe.srcdoc = initialHtml;
            }
            else {
                iframe.src = 'about:blank';
            }
            d.body.appendChild(iframe);
            // WebKit in WeChat doesn't fire the iframe's `onload` for some reason.
            // This code checks for the loading state manually.
            // See https://github.com/fingerprintjs/fingerprintjs/issues/645
            const checkReadyState = () => {
                var _a, _b;
                // The ready state may never become 'complete' in Firefox despite the 'load' event being fired.
                // So an infinite setTimeout loop can happen without this check.
                // See https://github.com/fingerprintjs/fingerprintjs/pull/716#issuecomment-986898796
                if (isComplete) {
                    return;
                }
                // Make sure iframe.contentWindow and iframe.contentWindow.document are both loaded
                // The contentWindow.document can miss in JSDOM (https://github.com/jsdom/jsdom).
                if (((_b = (_a = iframe.contentWindow) === null || _a === void 0 ? void 0 : _a.document) === null || _b === void 0 ? void 0 : _b.readyState) === 'complete') {
                    resolve();
                }
                else {
                    setTimeout(checkReadyState, 10);
                }
            };
            checkReadyState();
        });
        while (!((_b = (_a = iframe.contentWindow) === null || _a === void 0 ? void 0 : _a.document) === null || _b === void 0 ? void 0 : _b.body)) {
            await wait(domPollInterval);
        }
        return await action(iframe, iframe.contentWindow);
    }
    finally {
        (_c = iframe.parentNode) === null || _c === void 0 ? void 0 : _c.removeChild(iframe);
    }
}
/**
 * Creates a DOM element that matches the given selector.
 * Only single element selector are supported (without operators like space, +, >, etc).
 */
function selectorToElement(selector) {
    const [tag, attributes] = parseSimpleCssSelector(selector);
    const element = document.createElement(tag !== null && tag !== void 0 ? tag : 'div');
    for (const name of Object.keys(attributes)) {
        const value = attributes[name].join(' ');
        // Changing the `style` attribute can cause a CSP error, therefore we change the `style.cssText` property.
        // https://github.com/fingerprintjs/fingerprintjs/issues/733
        if (name === 'style') {
            addStyleString(element.style, value);
        }
        else {
            element.setAttribute(name, value);
        }
    }
    return element;
}
/**
 * Adds CSS styles from a string in such a way that doesn't trigger a CSP warning (unsafe-inline or unsafe-eval)
 */
function addStyleString(style, source) {
    // We don't use `style.cssText` because browsers must block it when no `unsafe-eval` CSP is presented: https://csplite.com/csp145/#w3c_note
    // Even though the browsers ignore this standard, we don't use `cssText` just in case.
    for (const property of source.split(';')) {
        const match = /^\s*([\w-]+)\s*:\s*(.+?)(\s*!([\w-]+))?\s*$/.exec(property);
        if (match) {
            const [, name, value, , priority] = match;
            style.setProperty(name, value, priority || ''); // The last argument can't be undefined in IE11
        }
    }
}
/**
 * Returns true if the code runs in an iframe, and any parent page's origin doesn't match the current origin
 */
function isAnyParentCrossOrigin() {
    let currentWindow = window;
    for (;;) {
        const parentWindow = currentWindow.parent;
        if (!parentWindow || parentWindow === currentWindow) {
            return false; // The top page is reached
        }
        try {
            if (parentWindow.location.origin !== currentWindow.location.origin) {
                return true;
            }
        }
        catch (error) {
            // The error is thrown when `origin` is accessed on `parentWindow.location` when the parent is cross-origin
            if (error instanceof Error && error.name === 'SecurityError') {
                return true;
            }
            throw error;
        }
        currentWindow = parentWindow;
    }
}

// We use m or w because these two characters take up the maximum width.
// And we use a LLi so that the same matching fonts can get separated.
const testString = 'mmMwWLliI0O&1';
// We test using 48px font size, we may use any size. I guess larger the better.
const textSize = '48px';
// A font will be compared against all the three default fonts.
// And if for any default fonts it doesn't match, then that font is available.
const baseFonts = ['monospace', 'sans-serif', 'serif'];
const fontList = [
    // This is android-specific font from "Roboto" family
    'sans-serif-thin',
    'ARNO PRO',
    'Agency FB',
    'Arabic Typesetting',
    'Arial Unicode MS',
    'AvantGarde Bk BT',
    'BankGothic Md BT',
    'Batang',
    'Bitstream Vera Sans Mono',
    'Calibri',
    'Century',
    'Century Gothic',
    'Clarendon',
    'EUROSTILE',
    'Franklin Gothic',
    'Futura Bk BT',
    'Futura Md BT',
    'GOTHAM',
    'Gill Sans',
    'HELV',
    'Haettenschweiler',
    'Helvetica Neue',
    'Humanst521 BT',
    'Leelawadee',
    'Letter Gothic',
    'Levenim MT',
    'Lucida Bright',
    'Lucida Sans',
    'Menlo',
    'MS Mincho',
    'MS Outlook',
    'MS Reference Specialty',
    'MS UI Gothic',
    'MT Extra',
    'MYRIAD PRO',
    'Marlett',
    'Meiryo UI',
    'Microsoft Uighur',
    'Minion Pro',
    'Monotype Corsiva',
    'PMingLiU',
    'Pristina',
    'SCRIPTINA',
    'Segoe UI Light',
    'Serifa',
    'SimHei',
    'Small Fonts',
    'Staccato222 BT',
    'TRAJAN PRO',
    'Univers CE 55 Medium',
    'Vrinda',
    'ZWAdobeF',
];
// kudos to http://www.lalit.org/lab/javascript-css-font-detect/
function getFonts() {
    // Running the script in an iframe makes it not affect the page look and not be affected by the page CSS. See:
    // https://github.com/fingerprintjs/fingerprintjs/issues/592
    // https://github.com/fingerprintjs/fingerprintjs/issues/628
    return withIframe(async (_, { document }) => {
        const holder = document.body;
        holder.style.fontSize = textSize;
        // div to load spans for the default fonts and the fonts to detect
        const spansContainer = document.createElement('div');
        spansContainer.style.setProperty('visibility', 'hidden', 'important');
        const defaultWidth = {};
        const defaultHeight = {};
        // creates a span where the fonts will be loaded
        const createSpan = (fontFamily) => {
            const span = document.createElement('span');
            const { style } = span;
            style.position = 'absolute';
            style.top = '0';
            style.left = '0';
            style.fontFamily = fontFamily;
            span.textContent = testString;
            spansContainer.appendChild(span);
            return span;
        };
        // creates a span and load the font to detect and a base font for fallback
        const createSpanWithFonts = (fontToDetect, baseFont) => {
            return createSpan(`'${fontToDetect}',${baseFont}`);
        };
        // creates spans for the base fonts and adds them to baseFontsDiv
        const initializeBaseFontsSpans = () => {
            return baseFonts.map(createSpan);
        };
        // creates spans for the fonts to detect and adds them to fontsDiv
        const initializeFontsSpans = () => {
            // Stores {fontName : [spans for that font]}
            const spans = {};
            for (const font of fontList) {
                spans[font] = baseFonts.map((baseFont) => createSpanWithFonts(font, baseFont));
            }
            return spans;
        };
        // checks if a font is available
        const isFontAvailable = (fontSpans) => {
            return baseFonts.some((baseFont, baseFontIndex) => fontSpans[baseFontIndex].offsetWidth !== defaultWidth[baseFont] ||
                fontSpans[baseFontIndex].offsetHeight !== defaultHeight[baseFont]);
        };
        // create spans for base fonts
        const baseFontsSpans = initializeBaseFontsSpans();
        // create spans for fonts to detect
        const fontsSpans = initializeFontsSpans();
        // add all the spans to the DOM
        holder.appendChild(spansContainer);
        // get the default width for the three base fonts
        for (let index = 0; index < baseFonts.length; index++) {
            defaultWidth[baseFonts[index]] = baseFontsSpans[index].offsetWidth; // width for the default font
            defaultHeight[baseFonts[index]] = baseFontsSpans[index].offsetHeight; // height for the default font
        }
        // check available fonts
        return fontList.filter((font) => isFontAvailable(fontsSpans[font]));
    });
}

function getPlugins() {
    const rawPlugins = navigator.plugins;
    if (!rawPlugins) {
        return undefined;
    }
    const plugins = [];
    // Safari 10 doesn't support iterating navigator.plugins with for...of
    for (let i = 0; i < rawPlugins.length; ++i) {
        const plugin = rawPlugins[i];
        if (!plugin) {
            continue;
        }
        const mimeTypes = [];
        for (let j = 0; j < plugin.length; ++j) {
            const mimeType = plugin[j];
            mimeTypes.push({
                type: mimeType.type,
                suffixes: mimeType.suffixes,
            });
        }
        plugins.push({
            name: plugin.name,
            description: plugin.description,
            mimeTypes,
        });
    }
    return plugins;
}

/**
 * @see https://www.browserleaks.com/canvas#how-does-it-work
 *
 * A version of the entropy source with stabilization to make it suitable for static fingerprinting.
 * Canvas image is noised in private mode of Safari 17, so image rendering is skipped in Safari 17.
 */
function getCanvasFingerprint() {
    return getUnstableCanvasFingerprint(doesBrowserPerformAntifingerprinting());
}
/**
 * A version of the entropy source without stabilization.
 *
 * Warning for package users:
 * This function is out of Semantic Versioning, i.e. can change unexpectedly. Usage is at your own risk.
 */
function getUnstableCanvasFingerprint(skipImages) {
    let winding = false;
    let geometry;
    let text;
    const [canvas, context] = makeCanvasContext();
    if (!isSupported(canvas, context)) {
        geometry = text = "unsupported" /* ImageStatus.Unsupported */;
    }
    else {
        winding = doesSupportWinding(context);
        if (skipImages) {
            geometry = text = "skipped" /* ImageStatus.Skipped */;
        }
        else {
            [geometry, text] = renderImages(canvas, context);
        }
    }
    return { winding, geometry, text };
}
function makeCanvasContext() {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    return [canvas, canvas.getContext('2d')];
}
function isSupported(canvas, context) {
    return !!(context && canvas.toDataURL);
}
function doesSupportWinding(context) {
    // https://web.archive.org/web/20170825024655/http://blogs.adobe.com/webplatform/2013/01/30/winding-rules-in-canvas/
    // https://github.com/Modernizr/Modernizr/blob/master/feature-detects/canvas/winding.js
    context.rect(0, 0, 10, 10);
    context.rect(2, 2, 6, 6);
    return !context.isPointInPath(5, 5, 'evenodd');
}
function renderImages(canvas, context) {
    renderTextImage(canvas, context);
    const textImage1 = canvasToString(canvas);
    const textImage2 = canvasToString(canvas); // It's slightly faster to double-encode the text image
    // Some browsers add a noise to the canvas: https://github.com/fingerprintjs/fingerprintjs/issues/791
    // The canvas is excluded from the fingerprint in this case
    if (textImage1 !== textImage2) {
        return ["unstable" /* ImageStatus.Unstable */, "unstable" /* ImageStatus.Unstable */];
    }
    // Text is unstable:
    // https://github.com/fingerprintjs/fingerprintjs/issues/583
    // https://github.com/fingerprintjs/fingerprintjs/issues/103
    // Therefore it's extracted into a separate image.
    renderGeometryImage(canvas, context);
    const geometryImage = canvasToString(canvas);
    return [geometryImage, textImage1];
}
function renderTextImage(canvas, context) {
    // Resizing the canvas cleans it
    canvas.width = 240;
    canvas.height = 60;
    context.textBaseline = 'alphabetic';
    context.fillStyle = '#f60';
    context.fillRect(100, 1, 62, 20);
    context.fillStyle = '#069';
    // It's important to use explicit built-in fonts in order to exclude the affect of font preferences
    // (there is a separate entropy source for them).
    context.font = '11pt "Times New Roman"';
    // The choice of emojis has a gigantic impact on rendering performance (especially in FF).
    // Some newer emojis cause it to slow down 50-200 times.
    // There must be no text to the right of the emoji, see https://github.com/fingerprintjs/fingerprintjs/issues/574
    // A bare emoji shouldn't be used because the canvas will change depending on the script encoding:
    // https://github.com/fingerprintjs/fingerprintjs/issues/66
    // Escape sequence shouldn't be used too because Terser will turn it into a bare unicode.
    const printedText = `Cwm fjordbank gly ${String.fromCharCode(55357, 56835) /* 😃 */}`;
    context.fillText(printedText, 2, 15);
    context.fillStyle = 'rgba(102, 204, 0, 0.2)';
    context.font = '18pt Arial';
    context.fillText(printedText, 4, 45);
}
function renderGeometryImage(canvas, context) {
    // Resizing the canvas cleans it
    canvas.width = 122;
    canvas.height = 110;
    // Canvas blending
    // https://web.archive.org/web/20170826194121/http://blogs.adobe.com/webplatform/2013/01/28/blending-features-in-canvas/
    // http://jsfiddle.net/NDYV8/16/
    context.globalCompositeOperation = 'multiply';
    for (const [color, x, y] of [
        ['#f2f', 40, 40],
        ['#2ff', 80, 40],
        ['#ff2', 60, 80],
    ]) {
        context.fillStyle = color;
        context.beginPath();
        context.arc(x, y, 40, 0, Math.PI * 2, true);
        context.closePath();
        context.fill();
    }
    // Canvas winding
    // https://web.archive.org/web/20130913061632/http://blogs.adobe.com/webplatform/2013/01/30/winding-rules-in-canvas/
    // http://jsfiddle.net/NDYV8/19/
    context.fillStyle = '#f9c';
    context.arc(60, 60, 60, 0, Math.PI * 2, true);
    context.arc(60, 60, 20, 0, Math.PI * 2, true);
    context.fill('evenodd');
}
function canvasToString(canvas) {
    return canvas.toDataURL();
}
/**
 * Checks if the current browser is known for applying anti-fingerprinting measures in all or some critical modes
 */
function doesBrowserPerformAntifingerprinting() {
    // Safari 17
    return isWebKit() && isWebKit616OrNewer() && isSafariWebKit();
}

/**
 * This is a crude and primitive touch screen detection. It's not possible to currently reliably detect the availability
 * of a touch screen with a JS, without actually subscribing to a touch event.
 *
 * @see http://www.stucox.com/blog/you-cant-detect-a-touchscreen/
 * @see https://github.com/Modernizr/Modernizr/issues/548
 */
function getTouchSupport() {
    const n = navigator;
    let maxTouchPoints = 0;
    let touchEvent;
    if (n.maxTouchPoints !== undefined) {
        maxTouchPoints = toInt(n.maxTouchPoints);
    }
    else if (n.msMaxTouchPoints !== undefined) {
        maxTouchPoints = n.msMaxTouchPoints;
    }
    try {
        document.createEvent('TouchEvent');
        touchEvent = true;
    }
    catch (_a) {
        touchEvent = false;
    }
    const touchStart = 'ontouchstart' in window;
    return {
        maxTouchPoints,
        touchEvent,
        touchStart,
    };
}

function getOsCpu() {
    return navigator.oscpu;
}

function getLanguages() {
    const n = navigator;
    const result = [];
    const language = n.language || n.userLanguage || n.browserLanguage || n.systemLanguage;
    if (language !== undefined) {
        result.push([language]);
    }
    if (Array.isArray(n.languages)) {
        // Starting from Chromium 86, there is only a single value in `navigator.language` in Incognito mode:
        // the value of `navigator.language`. Therefore the value is ignored in this browser.
        if (!(isChromium() && isChromium86OrNewer())) {
            result.push(n.languages);
        }
    }
    else if (typeof n.languages === 'string') {
        const languages = n.languages;
        if (languages) {
            result.push(languages.split(','));
        }
    }
    return result;
}

function getColorDepth() {
    return window.screen.colorDepth;
}

function getDeviceMemory() {
    // `navigator.deviceMemory` is a string containing a number in some unidentified cases
    return replaceNaN(toFloat(navigator.deviceMemory), undefined);
}

/**
 * A version of the entropy source with stabilization to make it suitable for static fingerprinting.
 * The window resolution is always the document size in private mode of Safari 17,
 * so the window resolution is not used in Safari 17.
 */
function getScreenResolution() {
    if (isWebKit() && isWebKit616OrNewer() && isSafariWebKit()) {
        return undefined;
    }
    return getUnstableScreenResolution();
}
/**
 * A version of the entropy source without stabilization.
 *
 * Warning for package users:
 * This function is out of Semantic Versioning, i.e. can change unexpectedly. Usage is at your own risk.
 */
function getUnstableScreenResolution() {
    const s = screen;
    // Some browsers return screen resolution as strings, e.g. "1200", instead of a number, e.g. 1200.
    // I suspect it's done by certain plugins that randomize browser properties to prevent fingerprinting.
    // Some browsers even return  screen resolution as not numbers.
    const parseDimension = (value) => replaceNaN(toInt(value), null);
    const dimensions = [parseDimension(s.width), parseDimension(s.height)];
    dimensions.sort().reverse();
    return dimensions;
}

const screenFrameCheckInterval = 2500;
const roundingPrecision = 10;
// The type is readonly to protect from unwanted mutations
let screenFrameBackup;
let screenFrameSizeTimeoutId;
/**
 * Starts watching the screen frame size. When a non-zero size appears, the size is saved and the watch is stopped.
 * Later, when `getScreenFrame` runs, it will return the saved non-zero size if the current size is null.
 *
 * This trick is required to mitigate the fact that the screen frame turns null in some cases.
 * See more on this at https://github.com/fingerprintjs/fingerprintjs/issues/568
 */
function watchScreenFrame() {
    if (screenFrameSizeTimeoutId !== undefined) {
        return;
    }
    const checkScreenFrame = () => {
        const frameSize = getCurrentScreenFrame();
        if (isFrameSizeNull(frameSize)) {
            screenFrameSizeTimeoutId = setTimeout(checkScreenFrame, screenFrameCheckInterval);
        }
        else {
            screenFrameBackup = frameSize;
            screenFrameSizeTimeoutId = undefined;
        }
    };
    checkScreenFrame();
}
/**
 * A version of the entropy source without stabilization.
 *
 * Warning for package users:
 * This function is out of Semantic Versioning, i.e. can change unexpectedly. Usage is at your own risk.
 */
function getUnstableScreenFrame() {
    watchScreenFrame();
    return async () => {
        let frameSize = getCurrentScreenFrame();
        if (isFrameSizeNull(frameSize)) {
            if (screenFrameBackup) {
                return [...screenFrameBackup];
            }
            if (getFullscreenElement()) {
                // Some browsers set the screen frame to zero when programmatic fullscreen is on.
                // There is a chance of getting a non-zero frame after exiting the fullscreen.
                // See more on this at https://github.com/fingerprintjs/fingerprintjs/issues/568
                await exitFullscreen();
                frameSize = getCurrentScreenFrame();
            }
        }
        if (!isFrameSizeNull(frameSize)) {
            screenFrameBackup = frameSize;
        }
        return frameSize;
    };
}
/**
 * A version of the entropy source with stabilization to make it suitable for static fingerprinting.
 *
 * Sometimes the available screen resolution changes a bit, e.g. 1900x1440 → 1900x1439. A possible reason: macOS Dock
 * shrinks to fit more icons when there is too little space. The rounding is used to mitigate the difference.
 *
 * The frame width is always 0 in private mode of Safari 17, so the frame is not used in Safari 17.
 */
function getScreenFrame() {
    if (isWebKit() && isWebKit616OrNewer() && isSafariWebKit()) {
        return () => Promise.resolve(undefined);
    }
    const screenFrameGetter = getUnstableScreenFrame();
    return async () => {
        const frameSize = await screenFrameGetter();
        const processSize = (sideSize) => (sideSize === null ? null : round(sideSize, roundingPrecision));
        // It might look like I don't know about `for` and `map`.
        // In fact, such code is used to avoid TypeScript issues without using `as`.
        return [processSize(frameSize[0]), processSize(frameSize[1]), processSize(frameSize[2]), processSize(frameSize[3])];
    };
}
function getCurrentScreenFrame() {
    const s = screen;
    // Some browsers return screen resolution as strings, e.g. "1200", instead of a number, e.g. 1200.
    // I suspect it's done by certain plugins that randomize browser properties to prevent fingerprinting.
    //
    // Some browsers (IE, Edge ≤18) don't provide `screen.availLeft` and `screen.availTop`. The property values are
    // replaced with 0 in such cases to not lose the entropy from `screen.availWidth` and `screen.availHeight`.
    return [
        replaceNaN(toFloat(s.availTop), null),
        replaceNaN(toFloat(s.width) - toFloat(s.availWidth) - replaceNaN(toFloat(s.availLeft), 0), null),
        replaceNaN(toFloat(s.height) - toFloat(s.availHeight) - replaceNaN(toFloat(s.availTop), 0), null),
        replaceNaN(toFloat(s.availLeft), null),
    ];
}
function isFrameSizeNull(frameSize) {
    for (let i = 0; i < 4; ++i) {
        if (frameSize[i]) {
            return false;
        }
    }
    return true;
}

function getHardwareConcurrency() {
    // sometimes hardware concurrency is a string
    return replaceNaN(toInt(navigator.hardwareConcurrency), undefined);
}

function getTimezone() {
    var _a;
    const DateTimeFormat = (_a = window.Intl) === null || _a === void 0 ? void 0 : _a.DateTimeFormat;
    if (DateTimeFormat) {
        const timezone = new DateTimeFormat().resolvedOptions().timeZone;
        if (timezone) {
            return timezone;
        }
    }
    // For browsers that don't support timezone names
    // The minus is intentional because the JS offset is opposite to the real offset
    const offset = -getTimezoneOffset();
    return `UTC${offset >= 0 ? '+' : ''}${offset}`;
}
function getTimezoneOffset() {
    const currentYear = new Date().getFullYear();
    // The timezone offset may change over time due to daylight saving time (DST) shifts.
    // The non-DST timezone offset is used as the result timezone offset.
    // Since the DST season differs in the northern and the southern hemispheres,
    // both January and July timezones offsets are considered.
    return Math.max(
    // `getTimezoneOffset` returns a number as a string in some unidentified cases
    toFloat(new Date(currentYear, 0, 1).getTimezoneOffset()), toFloat(new Date(currentYear, 6, 1).getTimezoneOffset()));
}

function getSessionStorage() {
    try {
        return !!window.sessionStorage;
    }
    catch (error) {
        /* SecurityError when referencing it means it exists */
        return true;
    }
}

// https://bugzilla.mozilla.org/show_bug.cgi?id=781447
function getLocalStorage() {
    try {
        return !!window.localStorage;
    }
    catch (e) {
        /* SecurityError when referencing it means it exists */
        return true;
    }
}

function getIndexedDB() {
    // IE and Edge don't allow accessing indexedDB in private mode, therefore IE and Edge will have different
    // visitor identifier in normal and private modes.
    if (isTrident() || isEdgeHTML()) {
        return undefined;
    }
    try {
        return !!window.indexedDB;
    }
    catch (e) {
        /* SecurityError when referencing it means it exists */
        return true;
    }
}

function getOpenDatabase() {
    return !!window.openDatabase;
}

function getCpuClass() {
    return navigator.cpuClass;
}

function getPlatform() {
    // Android Chrome 86 and 87 and Android Firefox 80 and 84 don't mock the platform value when desktop mode is requested
    const { platform } = navigator;
    // iOS mocks the platform value when desktop version is requested: https://github.com/fingerprintjs/fingerprintjs/issues/514
    // iPad uses desktop mode by default since iOS 13
    // The value is 'MacIntel' on M1 Macs
    // The value is 'iPhone' on iPod Touch
    if (platform === 'MacIntel') {
        if (isWebKit() && !isDesktopWebKit()) {
            return isIPad() ? 'iPad' : 'iPhone';
        }
    }
    return platform;
}

function getVendor() {
    return navigator.vendor || '';
}

/**
 * Checks for browser-specific (not engine specific) global variables to tell browsers with the same engine apart.
 * Only somewhat popular browsers are considered.
 */
function getVendorFlavors() {
    const flavors = [];
    for (const key of [
        // Blink and some browsers on iOS
        'chrome',
        // Safari on macOS
        'safari',
        // Chrome on iOS (checked in 85 on 13 and 87 on 14)
        '__crWeb',
        '__gCrWeb',
        // Yandex Browser on iOS, macOS and Android (checked in 21.2 on iOS 14, macOS and Android)
        'yandex',
        // Yandex Browser on iOS (checked in 21.2 on 14)
        '__yb',
        '__ybro',
        // Firefox on iOS (checked in 32 on 14)
        '__firefox__',
        // Edge on iOS (checked in 46 on 14)
        '__edgeTrackingPreventionStatistics',
        'webkit',
        // Opera Touch on iOS (checked in 2.6 on 14)
        'oprt',
        // Samsung Internet on Android (checked in 11.1)
        'samsungAr',
        // UC Browser on Android (checked in 12.10 and 13.0)
        'ucweb',
        'UCShellJava',
        // Puffin on Android (checked in 9.0)
        'puffinDevice',
        // UC on iOS and Opera on Android have no specific global variables
        // Edge for Android isn't checked
    ]) {
        const value = window[key];
        if (value && typeof value === 'object') {
            flavors.push(key);
        }
    }
    return flavors.sort();
}

/**
 * navigator.cookieEnabled cannot detect custom or nuanced cookie blocking configurations. For example, when blocking
 * cookies via the Advanced Privacy Settings in IE9, it always returns true. And there have been issues in the past with
 * site-specific exceptions. Don't rely on it.
 *
 * @see https://github.com/Modernizr/Modernizr/blob/master/feature-detects/cookies.js Taken from here
 */
function areCookiesEnabled() {
    const d = document;
    // Taken from here: https://github.com/Modernizr/Modernizr/blob/master/feature-detects/cookies.js
    // navigator.cookieEnabled cannot detect custom or nuanced cookie blocking configurations. For example, when blocking
    // cookies via the Advanced Privacy Settings in IE9, it always returns true. And there have been issues in the past
    // with site-specific exceptions. Don't rely on it.
    // try..catch because some in situations `document.cookie` is exposed but throws a
    // SecurityError if you try to access it; e.g. documents created from data URIs
    // or in sandboxed iframes (depending on flags/context)
    try {
        // Create cookie
        d.cookie = 'cookietest=1; SameSite=Strict;';
        const result = d.cookie.indexOf('cookietest=') !== -1;
        // Delete cookie
        d.cookie = 'cookietest=1; SameSite=Strict; expires=Thu, 01-Jan-1970 00:00:01 GMT';
        return result;
    }
    catch (e) {
        return false;
    }
}

/**
 * Only single element selector are supported (no operators like space, +, >, etc).
 * `embed` and `position: fixed;` will be considered as blocked anyway because it always has no offsetParent.
 * Avoid `iframe` and anything with `[src=]` because they produce excess HTTP requests.
 *
 * The "inappropriate" selectors are obfuscated. See https://github.com/fingerprintjs/fingerprintjs/issues/734.
 * A function is used instead of a plain object to help tree-shaking.
 *
 * The function code is generated automatically. See docs/content_blockers.md to learn how to make the list.
 */
function getFilters() {
    const fromB64 = atob; // Just for better minification
    return {
        abpIndo: [
            '#Iklan-Melayang',
            '#Kolom-Iklan-728',
            '#SidebarIklan-wrapper',
            '[title="ALIENBOLA" i]',
            fromB64('I0JveC1CYW5uZXItYWRz'),
        ],
        abpvn: ['.quangcao', '#mobileCatfish', fromB64('LmNsb3NlLWFkcw=='), '[id^="bn_bottom_fixed_"]', '#pmadv'],
        adBlockFinland: [
            '.mainostila',
            fromB64('LnNwb25zb3JpdA=='),
            '.ylamainos',
            fromB64('YVtocmVmKj0iL2NsaWNrdGhyZ2guYXNwPyJd'),
            fromB64('YVtocmVmXj0iaHR0cHM6Ly9hcHAucmVhZHBlYWsuY29tL2FkcyJd'),
        ],
        adBlockPersian: [
            '#navbar_notice_50',
            '.kadr',
            'TABLE[width="140px"]',
            '#divAgahi',
            fromB64('YVtocmVmXj0iaHR0cDovL2cxLnYuZndtcm0ubmV0L2FkLyJd'),
        ],
        adBlockWarningRemoval: [
            '#adblock-honeypot',
            '.adblocker-root',
            '.wp_adblock_detect',
            fromB64('LmhlYWRlci1ibG9ja2VkLWFk'),
            fromB64('I2FkX2Jsb2NrZXI='),
        ],
        adGuardAnnoyances: [
            '.hs-sosyal',
            '#cookieconsentdiv',
            'div[class^="app_gdpr"]',
            '.as-oil',
            '[data-cypress="soft-push-notification-modal"]',
        ],
        adGuardBase: [
            '.BetterJsPopOverlay',
            fromB64('I2FkXzMwMFgyNTA='),
            fromB64('I2Jhbm5lcmZsb2F0MjI='),
            fromB64('I2NhbXBhaWduLWJhbm5lcg=='),
            fromB64('I0FkLUNvbnRlbnQ='),
        ],
        adGuardChinese: [
            fromB64('LlppX2FkX2FfSA=='),
            fromB64('YVtocmVmKj0iLmh0aGJldDM0LmNvbSJd'),
            '#widget-quan',
            fromB64('YVtocmVmKj0iLzg0OTkyMDIwLnh5eiJd'),
            fromB64('YVtocmVmKj0iLjE5NTZobC5jb20vIl0='),
        ],
        adGuardFrench: [
            '#pavePub',
            fromB64('LmFkLWRlc2t0b3AtcmVjdGFuZ2xl'),
            '.mobile_adhesion',
            '.widgetadv',
            fromB64('LmFkc19iYW4='),
        ],
        adGuardGerman: ['aside[data-portal-id="leaderboard"]'],
        adGuardJapanese: [
            '#kauli_yad_1',
            fromB64('YVtocmVmXj0iaHR0cDovL2FkMi50cmFmZmljZ2F0ZS5uZXQvIl0='),
            fromB64('Ll9wb3BJbl9pbmZpbml0ZV9hZA=='),
            fromB64('LmFkZ29vZ2xl'),
            fromB64('Ll9faXNib29zdFJldHVybkFk'),
        ],
        adGuardMobile: [
            fromB64('YW1wLWF1dG8tYWRz'),
            fromB64('LmFtcF9hZA=='),
            'amp-embed[type="24smi"]',
            '#mgid_iframe1',
            fromB64('I2FkX2ludmlld19hcmVh'),
        ],
        adGuardRussian: [
            fromB64('YVtocmVmXj0iaHR0cHM6Ly9hZC5sZXRtZWFkcy5jb20vIl0='),
            fromB64('LnJlY2xhbWE='),
            'div[id^="smi2adblock"]',
            fromB64('ZGl2W2lkXj0iQWRGb3hfYmFubmVyXyJd'),
            '#psyduckpockeball',
        ],
        adGuardSocial: [
            fromB64('YVtocmVmXj0iLy93d3cuc3R1bWJsZXVwb24uY29tL3N1Ym1pdD91cmw9Il0='),
            fromB64('YVtocmVmXj0iLy90ZWxlZ3JhbS5tZS9zaGFyZS91cmw/Il0='),
            '.etsy-tweet',
            '#inlineShare',
            '.popup-social',
        ],
        adGuardSpanishPortuguese: ['#barraPublicidade', '#Publicidade', '#publiEspecial', '#queTooltip', '.cnt-publi'],
        adGuardTrackingProtection: [
            '#qoo-counter',
            fromB64('YVtocmVmXj0iaHR0cDovL2NsaWNrLmhvdGxvZy5ydS8iXQ=='),
            fromB64('YVtocmVmXj0iaHR0cDovL2hpdGNvdW50ZXIucnUvdG9wL3N0YXQucGhwIl0='),
            fromB64('YVtocmVmXj0iaHR0cDovL3RvcC5tYWlsLnJ1L2p1bXAiXQ=='),
            '#top100counter',
        ],
        adGuardTurkish: [
            '#backkapat',
            fromB64('I3Jla2xhbWk='),
            fromB64('YVtocmVmXj0iaHR0cDovL2Fkc2Vydi5vbnRlay5jb20udHIvIl0='),
            fromB64('YVtocmVmXj0iaHR0cDovL2l6bGVuemkuY29tL2NhbXBhaWduLyJd'),
            fromB64('YVtocmVmXj0iaHR0cDovL3d3dy5pbnN0YWxsYWRzLm5ldC8iXQ=='),
        ],
        bulgarian: [fromB64('dGQjZnJlZW5ldF90YWJsZV9hZHM='), '#ea_intext_div', '.lapni-pop-over', '#xenium_hot_offers'],
        easyList: [
            '.yb-floorad',
            fromB64('LndpZGdldF9wb19hZHNfd2lkZ2V0'),
            fromB64('LnRyYWZmaWNqdW5reS1hZA=='),
            '.textad_headline',
            fromB64('LnNwb25zb3JlZC10ZXh0LWxpbmtz'),
        ],
        easyListChina: [
            fromB64('LmFwcGd1aWRlLXdyYXBbb25jbGljayo9ImJjZWJvcy5jb20iXQ=='),
            fromB64('LmZyb250cGFnZUFkdk0='),
            '#taotaole',
            '#aafoot.top_box',
            '.cfa_popup',
        ],
        easyListCookie: [
            '.ezmob-footer',
            '.cc-CookieWarning',
            '[data-cookie-number]',
            fromB64('LmF3LWNvb2tpZS1iYW5uZXI='),
            '.sygnal24-gdpr-modal-wrap',
        ],
        easyListCzechSlovak: [
            '#onlajny-stickers',
            fromB64('I3Jla2xhbW5pLWJveA=='),
            fromB64('LnJla2xhbWEtbWVnYWJvYXJk'),
            '.sklik',
            fromB64('W2lkXj0ic2tsaWtSZWtsYW1hIl0='),
        ],
        easyListDutch: [
            fromB64('I2FkdmVydGVudGll'),
            fromB64('I3ZpcEFkbWFya3RCYW5uZXJCbG9jaw=='),
            '.adstekst',
            fromB64('YVtocmVmXj0iaHR0cHM6Ly94bHR1YmUubmwvY2xpY2svIl0='),
            '#semilo-lrectangle',
        ],
        easyListGermany: [
            '#SSpotIMPopSlider',
            fromB64('LnNwb25zb3JsaW5rZ3J1ZW4='),
            fromB64('I3dlcmJ1bmdza3k='),
            fromB64('I3Jla2xhbWUtcmVjaHRzLW1pdHRl'),
            fromB64('YVtocmVmXj0iaHR0cHM6Ly9iZDc0Mi5jb20vIl0='),
        ],
        easyListItaly: [
            fromB64('LmJveF9hZHZfYW5udW5jaQ=='),
            '.sb-box-pubbliredazionale',
            fromB64('YVtocmVmXj0iaHR0cDovL2FmZmlsaWF6aW9uaWFkcy5zbmFpLml0LyJd'),
            fromB64('YVtocmVmXj0iaHR0cHM6Ly9hZHNlcnZlci5odG1sLml0LyJd'),
            fromB64('YVtocmVmXj0iaHR0cHM6Ly9hZmZpbGlhemlvbmlhZHMuc25haS5pdC8iXQ=='),
        ],
        easyListLithuania: [
            fromB64('LnJla2xhbW9zX3RhcnBhcw=='),
            fromB64('LnJla2xhbW9zX251b3JvZG9z'),
            fromB64('aW1nW2FsdD0iUmVrbGFtaW5pcyBza3lkZWxpcyJd'),
            fromB64('aW1nW2FsdD0iRGVkaWt1b3RpLmx0IHNlcnZlcmlhaSJd'),
            fromB64('aW1nW2FsdD0iSG9zdGluZ2FzIFNlcnZlcmlhaS5sdCJd'),
        ],
        estonian: [fromB64('QVtocmVmKj0iaHR0cDovL3BheTRyZXN1bHRzMjQuZXUiXQ==')],
        fanboyAnnoyances: ['#ac-lre-player', '.navigate-to-top', '#subscribe_popup', '.newsletter_holder', '#back-top'],
        fanboyAntiFacebook: ['.util-bar-module-firefly-visible'],
        fanboyEnhancedTrackers: [
            '.open.pushModal',
            '#issuem-leaky-paywall-articles-zero-remaining-nag',
            '#sovrn_container',
            'div[class$="-hide"][zoompage-fontsize][style="display: block;"]',
            '.BlockNag__Card',
        ],
        fanboySocial: ['#FollowUs', '#meteored_share', '#social_follow', '.article-sharer', '.community__social-desc'],
        frellwitSwedish: [
            fromB64('YVtocmVmKj0iY2FzaW5vcHJvLnNlIl1bdGFyZ2V0PSJfYmxhbmsiXQ=='),
            fromB64('YVtocmVmKj0iZG9rdG9yLXNlLm9uZWxpbmsubWUiXQ=='),
            'article.category-samarbete',
            fromB64('ZGl2LmhvbGlkQWRz'),
            'ul.adsmodern',
        ],
        greekAdBlock: [
            fromB64('QVtocmVmKj0iYWRtYW4ub3RlbmV0LmdyL2NsaWNrPyJd'),
            fromB64('QVtocmVmKj0iaHR0cDovL2F4aWFiYW5uZXJzLmV4b2R1cy5nci8iXQ=='),
            fromB64('QVtocmVmKj0iaHR0cDovL2ludGVyYWN0aXZlLmZvcnRobmV0LmdyL2NsaWNrPyJd'),
            'DIV.agores300',
            'TABLE.advright',
        ],
        hungarian: [
            '#cemp_doboz',
            '.optimonk-iframe-container',
            fromB64('LmFkX19tYWlu'),
            fromB64('W2NsYXNzKj0iR29vZ2xlQWRzIl0='),
            '#hirdetesek_box',
        ],
        iDontCareAboutCookies: [
            '.alert-info[data-block-track*="CookieNotice"]',
            '.ModuleTemplateCookieIndicator',
            '.o--cookies--container',
            '#cookies-policy-sticky',
            '#stickyCookieBar',
        ],
        icelandicAbp: [fromB64('QVtocmVmXj0iL2ZyYW1ld29yay9yZXNvdXJjZXMvZm9ybXMvYWRzLmFzcHgiXQ==')],
        latvian: [
            fromB64('YVtocmVmPSJodHRwOi8vd3d3LnNhbGlkemluaS5sdi8iXVtzdHlsZT0iZGlzcGxheTogYmxvY2s7IHdpZHRoOiAxMjBweDsgaGVpZ2h0O' +
                'iA0MHB4OyBvdmVyZmxvdzogaGlkZGVuOyBwb3NpdGlvbjogcmVsYXRpdmU7Il0='),
            fromB64('YVtocmVmPSJodHRwOi8vd3d3LnNhbGlkemluaS5sdi8iXVtzdHlsZT0iZGlzcGxheTogYmxvY2s7IHdpZHRoOiA4OHB4OyBoZWlnaHQ6I' +
                'DMxcHg7IG92ZXJmbG93OiBoaWRkZW47IHBvc2l0aW9uOiByZWxhdGl2ZTsiXQ=='),
        ],
        listKr: [
            fromB64('YVtocmVmKj0iLy9hZC5wbGFuYnBsdXMuY28ua3IvIl0='),
            fromB64('I2xpdmVyZUFkV3JhcHBlcg=='),
            fromB64('YVtocmVmKj0iLy9hZHYuaW1hZHJlcC5jby5rci8iXQ=='),
            fromB64('aW5zLmZhc3R2aWV3LWFk'),
            '.revenue_unit_item.dable',
        ],
        listeAr: [
            fromB64('LmdlbWluaUxCMUFk'),
            '.right-and-left-sponsers',
            fromB64('YVtocmVmKj0iLmFmbGFtLmluZm8iXQ=='),
            fromB64('YVtocmVmKj0iYm9vcmFxLm9yZyJd'),
            fromB64('YVtocmVmKj0iZHViaXp6bGUuY29tL2FyLz91dG1fc291cmNlPSJd'),
        ],
        listeFr: [
            fromB64('YVtocmVmXj0iaHR0cDovL3Byb21vLnZhZG9yLmNvbS8iXQ=='),
            fromB64('I2FkY29udGFpbmVyX3JlY2hlcmNoZQ=='),
            fromB64('YVtocmVmKj0id2Vib3JhbWEuZnIvZmNnaS1iaW4vIl0='),
            '.site-pub-interstitiel',
            'div[id^="crt-"][data-criteo-id]',
        ],
        officialPolish: [
            '#ceneo-placeholder-ceneo-12',
            fromB64('W2hyZWZePSJodHRwczovL2FmZi5zZW5kaHViLnBsLyJd'),
            fromB64('YVtocmVmXj0iaHR0cDovL2Fkdm1hbmFnZXIudGVjaGZ1bi5wbC9yZWRpcmVjdC8iXQ=='),
            fromB64('YVtocmVmXj0iaHR0cDovL3d3dy50cml6ZXIucGwvP3V0bV9zb3VyY2UiXQ=='),
            fromB64('ZGl2I3NrYXBpZWNfYWQ='),
        ],
        ro: [
            fromB64('YVtocmVmXj0iLy9hZmZ0cmsuYWx0ZXgucm8vQ291bnRlci9DbGljayJd'),
            fromB64('YVtocmVmXj0iaHR0cHM6Ly9ibGFja2ZyaWRheXNhbGVzLnJvL3Ryay9zaG9wLyJd'),
            fromB64('YVtocmVmXj0iaHR0cHM6Ly9ldmVudC4ycGVyZm9ybWFudC5jb20vZXZlbnRzL2NsaWNrIl0='),
            fromB64('YVtocmVmXj0iaHR0cHM6Ly9sLnByb2ZpdHNoYXJlLnJvLyJd'),
            'a[href^="/url/"]',
        ],
        ruAd: [
            fromB64('YVtocmVmKj0iLy9mZWJyYXJlLnJ1LyJd'),
            fromB64('YVtocmVmKj0iLy91dGltZy5ydS8iXQ=='),
            fromB64('YVtocmVmKj0iOi8vY2hpa2lkaWtpLnJ1Il0='),
            '#pgeldiz',
            '.yandex-rtb-block',
        ],
        thaiAds: [
            'a[href*=macau-uta-popup]',
            fromB64('I2Fkcy1nb29nbGUtbWlkZGxlX3JlY3RhbmdsZS1ncm91cA=='),
            fromB64('LmFkczMwMHM='),
            '.bumq',
            '.img-kosana',
        ],
        webAnnoyancesUltralist: [
            '#mod-social-share-2',
            '#social-tools',
            fromB64('LmN0cGwtZnVsbGJhbm5lcg=='),
            '.zergnet-recommend',
            '.yt.btn-link.btn-md.btn',
        ],
    };
}
/**
 * The order of the returned array means nothing (it's always sorted alphabetically).
 *
 * Notice that the source is slightly unstable.
 * Safari provides a 2-taps way to disable all content blockers on a page temporarily.
 * Also content blockers can be disabled permanently for a domain, but it requires 4 taps.
 * So empty array shouldn't be treated as "no blockers", it should be treated as "no signal".
 * If you are a website owner, don't make your visitors want to disable content blockers.
 */
async function getDomBlockers({ debug } = {}) {
    if (!isApplicable()) {
        return undefined;
    }
    const filters = getFilters();
    const filterNames = Object.keys(filters);
    const allSelectors = [].concat(...filterNames.map((filterName) => filters[filterName]));
    const blockedSelectors = await getBlockedSelectors(allSelectors);
    if (debug) {
        printDebug(filters, blockedSelectors);
    }
    const activeBlockers = filterNames.filter((filterName) => {
        const selectors = filters[filterName];
        const blockedCount = countTruthy(selectors.map((selector) => blockedSelectors[selector]));
        return blockedCount > selectors.length * 0.6;
    });
    activeBlockers.sort();
    return activeBlockers;
}
function isApplicable() {
    // Safari (desktop and mobile) and all Android browsers keep content blockers in both regular and private mode
    return isWebKit() || isAndroid();
}
async function getBlockedSelectors(selectors) {
    var _a;
    const d = document;
    const root = d.createElement('div');
    const elements = new Array(selectors.length);
    const blockedSelectors = {}; // Set() isn't used just in case somebody need older browser support
    forceShow(root);
    // First create all elements that can be blocked. If the DOM steps below are done in a single cycle,
    // browser will alternate tree modification and layout reading, that is very slow.
    for (let i = 0; i < selectors.length; ++i) {
        const element = selectorToElement(selectors[i]);
        if (element.tagName === 'DIALOG') {
            element.show();
        }
        const holder = d.createElement('div'); // Protects from unwanted effects of `+` and `~` selectors of filters
        forceShow(holder);
        holder.appendChild(element);
        root.appendChild(holder);
        elements[i] = element;
    }
    // document.body can be null while the page is loading
    while (!d.body) {
        await wait(50);
    }
    d.body.appendChild(root);
    try {
        // Then check which of the elements are blocked
        for (let i = 0; i < selectors.length; ++i) {
            if (!elements[i].offsetParent) {
                blockedSelectors[selectors[i]] = true;
            }
        }
    }
    finally {
        // Then remove the elements
        (_a = root.parentNode) === null || _a === void 0 ? void 0 : _a.removeChild(root);
    }
    return blockedSelectors;
}
function forceShow(element) {
    element.style.setProperty('visibility', 'hidden', 'important');
    element.style.setProperty('display', 'block', 'important');
}
function printDebug(filters, blockedSelectors) {
    let message = 'DOM blockers debug:\n```';
    for (const filterName of Object.keys(filters)) {
        message += `\n${filterName}:`;
        for (const selector of filters[filterName]) {
            message += `\n  ${blockedSelectors[selector] ? '🚫' : '➡️'} ${selector}`;
        }
    }
    // console.log is ok here because it's under a debug clause
    // eslint-disable-next-line no-console
    console.log(`${message}\n\`\`\``);
}

/**
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@media/color-gamut
 */
function getColorGamut() {
    // rec2020 includes p3 and p3 includes srgb
    for (const gamut of ['rec2020', 'p3', 'srgb']) {
        if (matchMedia(`(color-gamut: ${gamut})`).matches) {
            return gamut;
        }
    }
    return undefined;
}

/**
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@media/inverted-colors
 */
function areColorsInverted() {
    if (doesMatch$5('inverted')) {
        return true;
    }
    if (doesMatch$5('none')) {
        return false;
    }
    return undefined;
}
function doesMatch$5(value) {
    return matchMedia(`(inverted-colors: ${value})`).matches;
}

/**
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@media/forced-colors
 */
function areColorsForced() {
    if (doesMatch$4('active')) {
        return true;
    }
    if (doesMatch$4('none')) {
        return false;
    }
    return undefined;
}
function doesMatch$4(value) {
    return matchMedia(`(forced-colors: ${value})`).matches;
}

const maxValueToCheck = 100;
/**
 * If the display is monochrome (e.g. black&white), the value will be ≥0 and will mean the number of bits per pixel.
 * If the display is not monochrome, the returned value will be 0.
 * If the browser doesn't support this feature, the returned value will be undefined.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@media/monochrome
 */
function getMonochromeDepth() {
    if (!matchMedia('(min-monochrome: 0)').matches) {
        // The media feature isn't supported by the browser
        return undefined;
    }
    // A variation of binary search algorithm can be used here.
    // But since expected values are very small (≤10), there is no sense in adding the complexity.
    for (let i = 0; i <= maxValueToCheck; ++i) {
        if (matchMedia(`(max-monochrome: ${i})`).matches) {
            return i;
        }
    }
    throw new Error('Too high value');
}

/**
 * @see https://www.w3.org/TR/mediaqueries-5/#prefers-contrast
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-contrast
 */
function getContrastPreference() {
    if (doesMatch$3('no-preference')) {
        return 0 /* ContrastPreference.None */;
    }
    // The sources contradict on the keywords. Probably 'high' and 'low' will never be implemented.
    // Need to check it when all browsers implement the feature.
    if (doesMatch$3('high') || doesMatch$3('more')) {
        return 1 /* ContrastPreference.More */;
    }
    if (doesMatch$3('low') || doesMatch$3('less')) {
        return -1 /* ContrastPreference.Less */;
    }
    if (doesMatch$3('forced')) {
        return 10 /* ContrastPreference.ForcedColors */;
    }
    return undefined;
}
function doesMatch$3(value) {
    return matchMedia(`(prefers-contrast: ${value})`).matches;
}

/**
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
 */
function isMotionReduced() {
    if (doesMatch$2('reduce')) {
        return true;
    }
    if (doesMatch$2('no-preference')) {
        return false;
    }
    return undefined;
}
function doesMatch$2(value) {
    return matchMedia(`(prefers-reduced-motion: ${value})`).matches;
}

/**
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-transparency
 */
function isTransparencyReduced() {
    if (doesMatch$1('reduce')) {
        return true;
    }
    if (doesMatch$1('no-preference')) {
        return false;
    }
    return undefined;
}
function doesMatch$1(value) {
    return matchMedia(`(prefers-reduced-transparency: ${value})`).matches;
}

/**
 * @see https://www.w3.org/TR/mediaqueries-5/#dynamic-range
 */
function isHDR() {
    if (doesMatch('high')) {
        return true;
    }
    if (doesMatch('standard')) {
        return false;
    }
    return undefined;
}
function doesMatch(value) {
    return matchMedia(`(dynamic-range: ${value})`).matches;
}

const M = Math; // To reduce the minified code size
const fallbackFn = () => 0;
/**
 * @see https://gitlab.torproject.org/legacy/trac/-/issues/13018
 * @see https://bugzilla.mozilla.org/show_bug.cgi?id=531915
 */
function getMathFingerprint() {
    // Native operations
    const acos = M.acos || fallbackFn;
    const acosh = M.acosh || fallbackFn;
    const asin = M.asin || fallbackFn;
    const asinh = M.asinh || fallbackFn;
    const atanh = M.atanh || fallbackFn;
    const atan = M.atan || fallbackFn;
    const sin = M.sin || fallbackFn;
    const sinh = M.sinh || fallbackFn;
    const cos = M.cos || fallbackFn;
    const cosh = M.cosh || fallbackFn;
    const tan = M.tan || fallbackFn;
    const tanh = M.tanh || fallbackFn;
    const exp = M.exp || fallbackFn;
    const expm1 = M.expm1 || fallbackFn;
    const log1p = M.log1p || fallbackFn;
    // Operation polyfills
    const powPI = (value) => M.pow(M.PI, value);
    const acoshPf = (value) => M.log(value + M.sqrt(value * value - 1));
    const asinhPf = (value) => M.log(value + M.sqrt(value * value + 1));
    const atanhPf = (value) => M.log((1 + value) / (1 - value)) / 2;
    const sinhPf = (value) => M.exp(value) - 1 / M.exp(value) / 2;
    const coshPf = (value) => (M.exp(value) + 1 / M.exp(value)) / 2;
    const expm1Pf = (value) => M.exp(value) - 1;
    const tanhPf = (value) => (M.exp(2 * value) - 1) / (M.exp(2 * value) + 1);
    const log1pPf = (value) => M.log(1 + value);
    // Note: constant values are empirical
    return {
        acos: acos(0.123124234234234242),
        acosh: acosh(1e308),
        acoshPf: acoshPf(1e154),
        asin: asin(0.123124234234234242),
        asinh: asinh(1),
        asinhPf: asinhPf(1),
        atanh: atanh(0.5),
        atanhPf: atanhPf(0.5),
        atan: atan(0.5),
        sin: sin(-1e300),
        sinh: sinh(1),
        sinhPf: sinhPf(1),
        cos: cos(10.000000000123),
        cosh: cosh(1),
        coshPf: coshPf(1),
        tan: tan(-1e300),
        tanh: tanh(1),
        tanhPf: tanhPf(1),
        exp: exp(1),
        expm1: expm1(1),
        expm1Pf: expm1Pf(1),
        log1p: log1p(10),
        log1pPf: log1pPf(10),
        powPI: powPI(-100),
    };
}

/**
 * We use m or w because these two characters take up the maximum width.
 * Also there are a couple of ligatures.
 */
const defaultText = 'mmMwWLliI0fiflO&1';
/**
 * Settings of text blocks to measure. The keys are random but persistent words.
 */
const presets = {
    /**
     * The default font. User can change it in desktop Chrome, desktop Firefox, IE 11,
     * Android Chrome (but only when the size is ≥ than the default) and Android Firefox.
     */
    default: [],
    /** OS font on macOS. User can change its size and weight. Applies after Safari restart. */
    apple: [{ font: '-apple-system-body' }],
    /** User can change it in desktop Chrome and desktop Firefox. */
    serif: [{ fontFamily: 'serif' }],
    /** User can change it in desktop Chrome and desktop Firefox. */
    sans: [{ fontFamily: 'sans-serif' }],
    /** User can change it in desktop Chrome and desktop Firefox. */
    mono: [{ fontFamily: 'monospace' }],
    /**
     * Check the smallest allowed font size. User can change it in desktop Chrome, desktop Firefox and desktop Safari.
     * The height can be 0 in Chrome on a retina display.
     */
    min: [{ fontSize: '1px' }],
    /** Tells one OS from another in desktop Chrome. */
    system: [{ fontFamily: 'system-ui' }],
};
/**
 * The result is a dictionary of the width of the text samples.
 * Heights aren't included because they give no extra entropy and are unstable.
 *
 * The result is very stable in IE 11, Edge 18 and Safari 14.
 * The result changes when the OS pixel density changes in Chromium 87. The real pixel density is required to solve,
 * but seems like it's impossible: https://stackoverflow.com/q/1713771/1118709.
 * The "min" and the "mono" (only on Windows) value may change when the page is zoomed in Firefox 87.
 */
function getFontPreferences() {
    return withNaturalFonts((document, container) => {
        const elements = {};
        const sizes = {};
        // First create all elements to measure. If the DOM steps below are done in a single cycle,
        // browser will alternate tree modification and layout reading, that is very slow.
        for (const key of Object.keys(presets)) {
            const [style = {}, text = defaultText] = presets[key];
            const element = document.createElement('span');
            element.textContent = text;
            element.style.whiteSpace = 'nowrap';
            for (const name of Object.keys(style)) {
                const value = style[name];
                if (value !== undefined) {
                    element.style[name] = value;
                }
            }
            elements[key] = element;
            container.append(document.createElement('br'), element);
        }
        // Then measure the created elements
        for (const key of Object.keys(presets)) {
            sizes[key] = elements[key].getBoundingClientRect().width;
        }
        return sizes;
    });
}
/**
 * Creates a DOM environment that provides the most natural font available, including Android OS font.
 * Measurements of the elements are zoom-independent.
 * Don't put a content to measure inside an absolutely positioned element.
 */
function withNaturalFonts(action, containerWidthPx = 4000) {
    /*
     * Requirements for Android Chrome to apply the system font size to a text inside an iframe:
     * - The iframe mustn't have a `display: none;` style;
     * - The text mustn't be positioned absolutely;
     * - The text block must be wide enough.
     *   2560px on some devices in portrait orientation for the biggest font size option (32px);
     * - There must be much enough text to form a few lines (I don't know the exact numbers);
     * - The text must have the `text-size-adjust: none` style. Otherwise the text will scale in "Desktop site" mode;
     *
     * Requirements for Android Firefox to apply the system font size to a text inside an iframe:
     * - The iframe document must have a header: `<meta name="viewport" content="width=device-width, initial-scale=1" />`.
     *   The only way to set it is to use the `srcdoc` attribute of the iframe;
     * - The iframe content must get loaded before adding extra content with JavaScript;
     *
     * https://example.com as the iframe target always inherits Android font settings so it can be used as a reference.
     *
     * Observations on how page zoom affects the measurements:
     * - macOS Safari 11.1, 12.1, 13.1, 14.0: zoom reset + offsetWidth = 100% reliable;
     * - macOS Safari 11.1, 12.1, 13.1, 14.0: zoom reset + getBoundingClientRect = 100% reliable;
     * - macOS Safari 14.0: offsetWidth = 5% fluctuation;
     * - macOS Safari 14.0: getBoundingClientRect = 5% fluctuation;
     * - iOS Safari 9, 10, 11.0, 12.0: haven't found a way to zoom a page (pinch doesn't change layout);
     * - iOS Safari 13.1, 14.0: zoom reset + offsetWidth = 100% reliable;
     * - iOS Safari 13.1, 14.0: zoom reset + getBoundingClientRect = 100% reliable;
     * - iOS Safari 14.0: offsetWidth = 100% reliable;
     * - iOS Safari 14.0: getBoundingClientRect = 100% reliable;
     * - Chrome 42, 65, 80, 87: zoom 1/devicePixelRatio + offsetWidth = 1px fluctuation;
     * - Chrome 42, 65, 80, 87: zoom 1/devicePixelRatio + getBoundingClientRect = 100% reliable;
     * - Chrome 87: offsetWidth = 1px fluctuation;
     * - Chrome 87: getBoundingClientRect = 0.7px fluctuation;
     * - Firefox 48, 51: offsetWidth = 10% fluctuation;
     * - Firefox 48, 51: getBoundingClientRect = 10% fluctuation;
     * - Firefox 52, 53, 57, 62, 66, 67, 68, 71, 75, 80, 84: offsetWidth = width 100% reliable, height 10% fluctuation;
     * - Firefox 52, 53, 57, 62, 66, 67, 68, 71, 75, 80, 84: getBoundingClientRect = width 100% reliable, height 10%
     *   fluctuation;
     * - Android Chrome 86: haven't found a way to zoom a page (pinch doesn't change layout);
     * - Android Firefox 84: font size in accessibility settings changes all the CSS sizes, but offsetWidth and
     *   getBoundingClientRect keep measuring with regular units, so the size reflects the font size setting and doesn't
     *   fluctuate;
     * - IE 11, Edge 18: zoom 1/devicePixelRatio + offsetWidth = 100% reliable;
     * - IE 11, Edge 18: zoom 1/devicePixelRatio + getBoundingClientRect = reflects the zoom level;
     * - IE 11, Edge 18: offsetWidth = 100% reliable;
     * - IE 11, Edge 18: getBoundingClientRect = 100% reliable;
     */
    return withIframe((_, iframeWindow) => {
        const iframeDocument = iframeWindow.document;
        const iframeBody = iframeDocument.body;
        const bodyStyle = iframeBody.style;
        bodyStyle.width = `${containerWidthPx}px`;
        bodyStyle.webkitTextSizeAdjust = bodyStyle.textSizeAdjust = 'none';
        // See the big comment above
        if (isChromium()) {
            iframeBody.style.zoom = `${1 / iframeWindow.devicePixelRatio}`;
        }
        else if (isWebKit()) {
            iframeBody.style.zoom = 'reset';
        }
        // See the big comment above
        const linesOfText = iframeDocument.createElement('div');
        linesOfText.textContent = [...Array((containerWidthPx / 20) << 0)].map(() => 'word').join(' ');
        iframeBody.appendChild(linesOfText);
        return action(iframeDocument, iframeBody);
    }, '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">');
}

function isPdfViewerEnabled() {
    return navigator.pdfViewerEnabled;
}

/**
 * Unlike most other architectures, on x86/x86-64 when floating-point instructions
 * have no NaN arguments, but produce NaN output, the output NaN has sign bit set.
 * We use it to distinguish x86/x86-64 from other architectures, by doing subtraction
 * of two infinities (must produce NaN per IEEE 754 standard).
 *
 * See https://codebrowser.bddppq.com/pytorch/pytorch/third_party/XNNPACK/src/init.c.html#79
 */
function getArchitecture() {
    const f = new Float32Array(1);
    const u8 = new Uint8Array(f.buffer);
    f[0] = Infinity;
    f[0] = f[0] - f[0];
    return u8[3];
}

/**
 * The return type is a union instead of the enum, because it's too challenging to embed the const enum into another
 * project. Turning it into a union is a simple and an elegant solution.
 */
function getApplePayState() {
    const { ApplePaySession } = window;
    if (typeof (ApplePaySession === null || ApplePaySession === void 0 ? void 0 : ApplePaySession.canMakePayments) !== 'function') {
        return -1 /* ApplePayState.NoAPI */;
    }
    if (willPrintConsoleError()) {
        return -3 /* ApplePayState.NotAvailableInFrame */;
    }
    try {
        return ApplePaySession.canMakePayments() ? 1 /* ApplePayState.Enabled */ : 0 /* ApplePayState.Disabled */;
    }
    catch (error) {
        return getStateFromError(error);
    }
}
/**
 * Starting from Safari 15 calling `ApplePaySession.canMakePayments()` produces this error message when FingerprintJS
 * runs in an iframe with a cross-origin parent page, and the iframe on that page has no allow="payment *" attribute:
 *   Feature policy 'Payment' check failed for element with origin 'https://example.com' and allow attribute ''.
 * This function checks whether the error message is expected.
 *
 * We check for cross-origin parents, which is prone to false-positive results. Instead, we should check for allowed
 * feature/permission, but we can't because none of these API works in Safari yet:
 *   navigator.permissions.query({ name: ‘payment' })
 *   navigator.permissions.query({ name: ‘payment-handler' })
 *   document.featurePolicy
 */
const willPrintConsoleError = isAnyParentCrossOrigin;
function getStateFromError(error) {
    // See full expected error messages in the test
    if (error instanceof Error && error.name === 'InvalidAccessError' && /\bfrom\b.*\binsecure\b/i.test(error.message)) {
        return -2 /* ApplePayState.NotAvailableInInsecureContext */;
    }
    throw error;
}

/**
 * Checks whether the Safari's Privacy Preserving Ad Measurement setting is on.
 * The setting is on when the value is not undefined.
 * A.k.a. private click measurement, privacy-preserving ad attribution.
 *
 * Unfortunately, it doesn't work in mobile Safari.
 * Probably, it will start working in mobile Safari or stop working in desktop Safari later.
 * We've found no way to detect the setting state in mobile Safari. Help wanted.
 *
 * @see https://webkit.org/blog/11529/introducing-private-click-measurement-pcm/
 * @see https://developer.apple.com/videos/play/wwdc2021/10033
 */
function getPrivateClickMeasurement() {
    var _a;
    const link = document.createElement('a');
    const sourceId = (_a = link.attributionSourceId) !== null && _a !== void 0 ? _a : link.attributionsourceid;
    return sourceId === undefined ? undefined : String(sourceId);
}

/** WebGl context is not available */
const STATUS_NO_GL_CONTEXT = -1;
/** WebGL context `getParameter` method is not a function */
const STATUS_GET_PARAMETER_NOT_A_FUNCTION = -2;
const validContextParameters = new Set([
    10752, 2849, 2884, 2885, 2886, 2928, 2929, 2930, 2931, 2932, 2960, 2961, 2962, 2963, 2964, 2965, 2966, 2967, 2968,
    2978, 3024, 3042, 3088, 3089, 3106, 3107, 32773, 32777, 32777, 32823, 32824, 32936, 32937, 32938, 32939, 32968, 32969,
    32970, 32971, 3317, 33170, 3333, 3379, 3386, 33901, 33902, 34016, 34024, 34076, 3408, 3410, 3411, 3412, 3413, 3414,
    3415, 34467, 34816, 34817, 34818, 34819, 34877, 34921, 34930, 35660, 35661, 35724, 35738, 35739, 36003, 36004, 36005,
    36347, 36348, 36349, 37440, 37441, 37443, 7936, 7937, 7938,
    // SAMPLE_ALPHA_TO_COVERAGE (32926) and SAMPLE_COVERAGE (32928) are excluded because they trigger a console warning
    // in IE, Chrome ≤ 59 and Safari ≤ 13 and give no entropy.
]);
const validExtensionParams = new Set([
    34047,
    35723,
    36063,
    34852,
    34853,
    34854,
    34229,
    36392,
    36795,
    38449, // MAX_VIEWS_OVR
]);
const shaderTypes = ['FRAGMENT_SHADER', 'VERTEX_SHADER'];
const precisionTypes = ['LOW_FLOAT', 'MEDIUM_FLOAT', 'HIGH_FLOAT', 'LOW_INT', 'MEDIUM_INT', 'HIGH_INT'];
const rendererInfoExtensionName = 'WEBGL_debug_renderer_info';
const polygonModeExtensionName = 'WEBGL_polygon_mode';
/**
 * Gets the basic and simple WebGL parameters
 */
function getWebGlBasics({ cache }) {
    var _a, _b, _c, _d, _e, _f;
    const gl = getWebGLContext(cache);
    if (!gl) {
        return STATUS_NO_GL_CONTEXT;
    }
    if (!isValidParameterGetter(gl)) {
        return STATUS_GET_PARAMETER_NOT_A_FUNCTION;
    }
    const debugExtension = shouldAvoidDebugRendererInfo() ? null : gl.getExtension(rendererInfoExtensionName);
    return {
        version: ((_a = gl.getParameter(gl.VERSION)) === null || _a === void 0 ? void 0 : _a.toString()) || '',
        vendor: ((_b = gl.getParameter(gl.VENDOR)) === null || _b === void 0 ? void 0 : _b.toString()) || '',
        vendorUnmasked: debugExtension ? (_c = gl.getParameter(debugExtension.UNMASKED_VENDOR_WEBGL)) === null || _c === void 0 ? void 0 : _c.toString() : '',
        renderer: ((_d = gl.getParameter(gl.RENDERER)) === null || _d === void 0 ? void 0 : _d.toString()) || '',
        rendererUnmasked: debugExtension ? (_e = gl.getParameter(debugExtension.UNMASKED_RENDERER_WEBGL)) === null || _e === void 0 ? void 0 : _e.toString() : '',
        shadingLanguageVersion: ((_f = gl.getParameter(gl.SHADING_LANGUAGE_VERSION)) === null || _f === void 0 ? void 0 : _f.toString()) || '',
    };
}
/**
 * Gets the advanced and massive WebGL parameters and extensions
 */
function getWebGlExtensions({ cache }) {
    const gl = getWebGLContext(cache);
    if (!gl) {
        return STATUS_NO_GL_CONTEXT;
    }
    if (!isValidParameterGetter(gl)) {
        return STATUS_GET_PARAMETER_NOT_A_FUNCTION;
    }
    const extensions = gl.getSupportedExtensions();
    const contextAttributes = gl.getContextAttributes();
    const unsupportedExtensions = [];
    // Features
    const attributes = [];
    const parameters = [];
    const extensionParameters = [];
    const shaderPrecisions = [];
    // Context attributes
    if (contextAttributes) {
        for (const attributeName of Object.keys(contextAttributes)) {
            attributes.push(`${attributeName}=${contextAttributes[attributeName]}`);
        }
    }
    // Context parameters
    const constants = getConstantsFromPrototype(gl);
    for (const constant of constants) {
        const code = gl[constant];
        parameters.push(`${constant}=${code}${validContextParameters.has(code) ? `=${gl.getParameter(code)}` : ''}`);
    }
    // Extension parameters
    if (extensions) {
        for (const name of extensions) {
            if ((name === rendererInfoExtensionName && shouldAvoidDebugRendererInfo()) ||
                (name === polygonModeExtensionName && shouldAvoidPolygonModeExtensions())) {
                continue;
            }
            const extension = gl.getExtension(name);
            if (!extension) {
                unsupportedExtensions.push(name);
                continue;
            }
            for (const constant of getConstantsFromPrototype(extension)) {
                const code = extension[constant];
                extensionParameters.push(`${constant}=${code}${validExtensionParams.has(code) ? `=${gl.getParameter(code)}` : ''}`);
            }
        }
    }
    // Shader precision
    for (const shaderType of shaderTypes) {
        for (const precisionType of precisionTypes) {
            const shaderPrecision = getShaderPrecision(gl, shaderType, precisionType);
            shaderPrecisions.push(`${shaderType}.${precisionType}=${shaderPrecision.join(',')}`);
        }
    }
    // Postprocess
    extensionParameters.sort();
    parameters.sort();
    return {
        contextAttributes: attributes,
        parameters: parameters,
        shaderPrecisions: shaderPrecisions,
        extensions: extensions,
        extensionParameters: extensionParameters,
        unsupportedExtensions,
    };
}
/**
 * This function usually takes the most time to execute in all the sources, therefore we cache its result.
 *
 * Warning for package users:
 * This function is out of Semantic Versioning, i.e. can change unexpectedly. Usage is at your own risk.
 */
function getWebGLContext(cache) {
    if (cache.webgl) {
        return cache.webgl.context;
    }
    const canvas = document.createElement('canvas');
    let context;
    canvas.addEventListener('webglCreateContextError', () => (context = undefined));
    for (const type of ['webgl', 'experimental-webgl']) {
        try {
            context = canvas.getContext(type);
        }
        catch (_a) {
            // Ok, continue
        }
        if (context) {
            break;
        }
    }
    cache.webgl = { context };
    return context;
}
/**
 * https://developer.mozilla.org/en-US/docs/Web/API/WebGLShaderPrecisionFormat
 * https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/getShaderPrecisionFormat
 * https://www.khronos.org/registry/webgl/specs/latest/1.0/#5.12
 */
function getShaderPrecision(gl, shaderType, precisionType) {
    const shaderPrecision = gl.getShaderPrecisionFormat(gl[shaderType], gl[precisionType]);
    return shaderPrecision ? [shaderPrecision.rangeMin, shaderPrecision.rangeMax, shaderPrecision.precision] : [];
}
function getConstantsFromPrototype(obj) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const keys = Object.keys(obj.__proto__);
    return keys.filter(isConstantLike);
}
function isConstantLike(key) {
    return typeof key === 'string' && !key.match(/[^A-Z0-9_x]/);
}
/**
 * Some browsers print a console warning when the WEBGL_debug_renderer_info extension is requested.
 * JS Agent aims to avoid printing messages to console, so we avoid this extension in that browsers.
 */
function shouldAvoidDebugRendererInfo() {
    return isGecko();
}
/**
 * Some browsers print a console warning when the WEBGL_polygon_mode extension is requested.
 * JS Agent aims to avoid printing messages to console, so we avoid this extension in that browsers.
 */
function shouldAvoidPolygonModeExtensions() {
    return isChromium() || isWebKit();
}
/**
 * Some unknown browsers have no `getParameter` method
 */
function isValidParameterGetter(gl) {
    return typeof gl.getParameter === 'function';
}

function getAudioContextBaseLatency() {
    // The signal emits warning in Chrome and Firefox, therefore it is enabled on Safari where it doesn't produce warning
    // and on Android where it's less visible
    const isAllowedPlatform = isAndroid() || isWebKit();
    if (!isAllowedPlatform) {
        return -2 /* SpecialFingerprint.Disabled */;
    }
    if (!window.AudioContext) {
        return -1 /* SpecialFingerprint.NotSupported */;
    }
    const latency = new AudioContext().baseLatency;
    if (latency === null || latency === undefined) {
        return -1 /* SpecialFingerprint.NotSupported */;
    }
    if (!isFinite(latency)) {
        return -3 /* SpecialFingerprint.NotFinite */;
    }
    return latency;
}

/**
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/resolvedOptions
 *
 * The return type is a union instead of a const enum due to the difficulty of embedding const enums in other projects.
 * This makes integration simpler and more elegant.
 */
function getDateTimeLocale() {
    if (!window.Intl) {
        return -1 /* Status.IntlAPINotSupported */;
    }
    const DateTimeFormat = window.Intl.DateTimeFormat;
    if (!DateTimeFormat) {
        return -2 /* Status.DateTimeFormatNotSupported */;
    }
    const locale = DateTimeFormat().resolvedOptions().locale;
    if (!locale && locale !== '') {
        return -3 /* Status.LocaleNotAvailable */;
    }
    return locale;
}

/**
 * The list of entropy sources used to make visitor identifiers.
 *
 * This value isn't restricted by Semantic Versioning, i.e. it may be changed without bumping minor or major version of
 * this package.
 *
 * Note: Rollup and Webpack are smart enough to remove unused properties of this object during tree-shaking, so there is
 * no need to export the sources individually.
 */
const sources = {
    // READ FIRST:
    // See https://github.com/fingerprintjs/fingerprintjs/blob/master/contributing.md#how-to-add-an-entropy-source
    // to learn how entropy source works and how to make your own.
    // The sources run in this exact order.
    // The asynchronous sources are at the start to run in parallel with other sources.
    fonts: getFonts,
    domBlockers: getDomBlockers,
    fontPreferences: getFontPreferences,
    audio: getAudioFingerprint,
    screenFrame: getScreenFrame,
    canvas: getCanvasFingerprint,
    osCpu: getOsCpu,
    languages: getLanguages,
    colorDepth: getColorDepth,
    deviceMemory: getDeviceMemory,
    screenResolution: getScreenResolution,
    hardwareConcurrency: getHardwareConcurrency,
    timezone: getTimezone,
    sessionStorage: getSessionStorage,
    localStorage: getLocalStorage,
    indexedDB: getIndexedDB,
    openDatabase: getOpenDatabase,
    cpuClass: getCpuClass,
    platform: getPlatform,
    plugins: getPlugins,
    touchSupport: getTouchSupport,
    vendor: getVendor,
    vendorFlavors: getVendorFlavors,
    cookiesEnabled: areCookiesEnabled,
    colorGamut: getColorGamut,
    invertedColors: areColorsInverted,
    forcedColors: areColorsForced,
    monochrome: getMonochromeDepth,
    contrast: getContrastPreference,
    reducedMotion: isMotionReduced,
    reducedTransparency: isTransparencyReduced,
    hdr: isHDR,
    math: getMathFingerprint,
    pdfViewerEnabled: isPdfViewerEnabled,
    architecture: getArchitecture,
    applePay: getApplePayState,
    privateClickMeasurement: getPrivateClickMeasurement,
    audioBaseLatency: getAudioContextBaseLatency,
    dateTimeLocale: getDateTimeLocale,
    // Some sources can affect other sources (e.g. WebGL can affect canvas), so it's important to run these sources
    // after other sources.
    webGlBasics: getWebGlBasics,
    webGlExtensions: getWebGlExtensions,
};
/**
 * Loads the built-in entropy sources.
 * Returns a function that collects the entropy components to make the visitor identifier.
 */
function loadBuiltinSources(options) {
    return loadSources(sources, options, []);
}

const commentTemplate = '$ if upgrade to Pro: https://fpjs.dev/pro';
function getConfidence(components) {
    const openConfidenceScore = getOpenConfidenceScore(components);
    const proConfidenceScore = deriveProConfidenceScore(openConfidenceScore);
    return { score: openConfidenceScore, comment: commentTemplate.replace(/\$/g, `${proConfidenceScore}`) };
}
function getOpenConfidenceScore(components) {
    // In order to calculate the true probability of the visitor identifier being correct, we need to know the number of
    // website visitors (the higher the number, the less the probability because the fingerprint entropy is limited).
    // JS agent doesn't know the number of visitors, so we can only do an approximate assessment.
    if (isAndroid()) {
        return 0.4;
    }
    // Safari (mobile and desktop)
    if (isWebKit()) {
        return isDesktopWebKit() && !(isWebKit616OrNewer() && isSafariWebKit()) ? 0.5 : 0.3;
    }
    const platform = 'value' in components.platform ? components.platform.value : '';
    // Windows
    if (/^Win/.test(platform)) {
        // The score is greater than on macOS because of the higher variety of devices running Windows.
        // Chrome provides more entropy than Firefox according too
        // https://netmarketshare.com/browser-market-share.aspx?options=%7B%22filter%22%3A%7B%22%24and%22%3A%5B%7B%22platform%22%3A%7B%22%24in%22%3A%5B%22Windows%22%5D%7D%7D%5D%7D%2C%22dateLabel%22%3A%22Trend%22%2C%22attributes%22%3A%22share%22%2C%22group%22%3A%22browser%22%2C%22sort%22%3A%7B%22share%22%3A-1%7D%2C%22id%22%3A%22browsersDesktop%22%2C%22dateInterval%22%3A%22Monthly%22%2C%22dateStart%22%3A%222019-11%22%2C%22dateEnd%22%3A%222020-10%22%2C%22segments%22%3A%22-1000%22%7D
        // So we assign the same score to them.
        return 0.6;
    }
    // macOS
    if (/^Mac/.test(platform)) {
        // Chrome provides more entropy than Safari and Safari provides more entropy than Firefox.
        // Chrome is more popular than Safari and Safari is more popular than Firefox according to
        // https://netmarketshare.com/browser-market-share.aspx?options=%7B%22filter%22%3A%7B%22%24and%22%3A%5B%7B%22platform%22%3A%7B%22%24in%22%3A%5B%22Mac%20OS%22%5D%7D%7D%5D%7D%2C%22dateLabel%22%3A%22Trend%22%2C%22attributes%22%3A%22share%22%2C%22group%22%3A%22browser%22%2C%22sort%22%3A%7B%22share%22%3A-1%7D%2C%22id%22%3A%22browsersDesktop%22%2C%22dateInterval%22%3A%22Monthly%22%2C%22dateStart%22%3A%222019-11%22%2C%22dateEnd%22%3A%222020-10%22%2C%22segments%22%3A%22-1000%22%7D
        // So we assign the same score to them.
        return 0.5;
    }
    // Another platform, e.g. a desktop Linux. It's rare, so it should be pretty unique.
    return 0.7;
}
function deriveProConfidenceScore(openConfidenceScore) {
    return round(0.99 + 0.01 * openConfidenceScore, 0.0001);
}

function componentsToCanonicalString(components) {
    let result = '';
    for (const componentKey of Object.keys(components).sort()) {
        const component = components[componentKey];
        const value = 'error' in component ? 'error' : JSON.stringify(component.value);
        result += `${result ? '|' : ''}${componentKey.replace(/([:|\\])/g, '\\$1')}:${value}`;
    }
    return result;
}
function componentsToDebugString(components) {
    return JSON.stringify(components, (_key, value) => {
        if (value instanceof Error) {
            return errorToObject(value);
        }
        return value;
    }, 2);
}
function hashComponents(components) {
    return x64hash128(componentsToCanonicalString(components));
}
/**
 * Makes a GetResult implementation that calculates the visitor id hash on demand.
 * Designed for optimisation.
 */
function makeLazyGetResult(components) {
    let visitorIdCache;
    // This function runs very fast, so there is no need to make it lazy
    const confidence = getConfidence(components);
    // A plain class isn't used because its getters and setters aren't enumerable.
    return {
        get visitorId() {
            if (visitorIdCache === undefined) {
                visitorIdCache = hashComponents(this.components);
            }
            return visitorIdCache;
        },
        set visitorId(visitorId) {
            visitorIdCache = visitorId;
        },
        confidence,
        components,
        version,
    };
}
/**
 * A delay is required to ensure consistent entropy components.
 * See https://github.com/fingerprintjs/fingerprintjs/issues/254
 * and https://github.com/fingerprintjs/fingerprintjs/issues/307
 * and https://github.com/fingerprintjs/fingerprintjs/commit/945633e7c5f67ae38eb0fea37349712f0e669b18
 */
function prepareForSources(delayFallback = 50) {
    // A proper deadline is unknown. Let it be twice the fallback timeout so that both cases have the same average time.
    return requestIdleCallbackIfAvailable(delayFallback, delayFallback * 2);
}
/**
 * The function isn't exported from the index file to not allow to call it without `load()`.
 * The hiding gives more freedom for future non-breaking updates.
 *
 * A factory function is used instead of a class to shorten the attribute names in the minified code.
 * Native private class fields could've been used, but TypeScript doesn't allow them with `"target": "es5"`.
 */
function makeAgent(getComponents, debug) {
    const creationTime = Date.now();
    return {
        async get(options) {
            const startTime = Date.now();
            const components = await getComponents();
            const result = makeLazyGetResult(components);
            if (debug || (options === null || options === void 0 ? void 0 : options.debug)) {
                // console.log is ok here because it's under a debug clause
                // eslint-disable-next-line no-console
                console.log(`Copy the text below to get the debug data:

\`\`\`
version: ${result.version}
userAgent: ${navigator.userAgent}
timeBetweenLoadAndGet: ${startTime - creationTime}
visitorId: ${result.visitorId}
components: ${componentsToDebugString(components)}
\`\`\``);
            }
            return result;
        },
    };
}
/**
 * Sends an unpersonalized AJAX request to collect installation statistics
 */
function monitor() {
    // The FingerprintJS CDN (https://github.com/fingerprintjs/cdn) replaces `window.__fpjs_d_m` with `true`
    if (window.__fpjs_d_m || Math.random() >= 0.001) {
        return;
    }
    try {
        const request = new XMLHttpRequest();
        request.open('get', `https://m1.openfpcdn.io/fingerprintjs/v${version}/npm-monitoring`, true);
        request.send();
    }
    catch (error) {
        // console.error is ok here because it's an unexpected error handler
        // eslint-disable-next-line no-console
        console.error(error);
    }
}
/**
 * Builds an instance of Agent and waits a delay required for a proper operation.
 */
async function load(options = {}) {
    var _a;
    if ((_a = options.monitoring) !== null && _a !== void 0 ? _a : true) {
        monitor();
    }
    const { delayFallback, debug } = options;
    await prepareForSources(delayFallback);
    const getComponents = loadBuiltinSources({ cache: {}, debug });
    return makeAgent(getComponents, debug);
}

// The default export is a syntax sugar (`import * as FP from '...' → import FP from '...'`).
// It should contain all the public exported values.
var index = { load, hashComponents, componentsToDebugString };

class FeedbackWidget {
    constructor(config) {
        this.isOpen = false;
        this.isSubmitting = false;
        this.feedbackType = '';
        this.currentScreenshot = '';
        if (!config.tracker)
            throw new Error('Feedback requires tracker');
        this.tracker = config.tracker;
        this.config = {
            position: config.position || 'bottom-left',
            themeColor: config.themeColor || '#4f46e5',
            buttonText: config.buttonText || 'Feedback',
            autoOpen: config.autoOpen || false,
            ...config,
        };
        this.init();
    }
    init() {
        this.addStyles();
        this.createButton();
        this.createFeedbackWindow();
        if (this.config.autoOpen === true)
            this.toggleFeedbackWindow();
    }
    getPositionStyle() {
        switch (this.config.position) {
            case 'bottom-left':
                return 'left:16px; bottom:16px;';
            case 'bottom-center':
                return 'left:50%; bottom:16px; transform:translateX(-50%);';
            default:
                return 'right:16px; bottom:16px;';
        }
    }
    toggleFeedbackWindow() {
        this.isOpen = !this.isOpen;
        this.feedbackWindow.classList.toggle('pt-open', this.isOpen);
        this.container.style.opacity = this.isOpen ? '0' : '1';
        this.container.style.pointerEvents = this.isOpen ? 'none' : 'auto';
    }
    setFeedbackType(type) {
        this.feedbackType = type;
        document.getElementById('pt-options').style.display = 'none';
        const badge = document.getElementById('pt-selected');
        badge.innerHTML = `
      <div class="pt-badge ${type}">
        <span>${type === 'error' ? 'Reportar error' : 'Enviar sugerencia'}</span>
        <button id="pt-change">Cambiar</button>
      </div>
    `;
        badge.style.display = 'block';
        document.getElementById('pt-change').onclick = () => {
            badge.style.display = 'none';
            document.getElementById('pt-options').style.display = 'grid';
            this.feedbackType = '';
        };
    }
    async captureScreenshot() {
        this.feedbackWindow.style.visibility = 'hidden';
        const canvas = await html2canvas(document.body, { scale: 1 });
        this.feedbackWindow.style.visibility = 'visible';
        this.currentScreenshot = canvas.toDataURL('image/png');
        document.getElementById('pt-shot-img').src =
            this.currentScreenshot;
        document.getElementById('pt-shot').style.display = 'block';
    }
    removeScreenshot() {
        this.currentScreenshot = '';
        document.getElementById('pt-shot').style.display = 'none';
    }
    async getFingerprint() {
        const fp = await index.load();
        return (await fp.get()).visitorId;
    }
    getUser() {
        return localStorage.getItem('tracker_user') || 'anonymous';
    }
    base64ToBlob(base64) {
        const [, data] = base64.split(',');
        const bytes = atob(data);
        const arr = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++)
            arr[i] = bytes.charCodeAt(i);
        return new Blob([arr], { type: 'image/png' });
    }
    async submitFeedback() {
        const textarea = document.getElementById('pt-text');
        if (!textarea.value.trim())
            return alert('Describe el feedback');
        const { token } = getConfig();
        const fd = new FormData();
        fd.append('type', this.feedbackType);
        fd.append('description', textarea.value);
        fd.append('url', location.href);
        fd.append('fingerprint', await this.getFingerprint());
        fd.append('userId', this.getUser());
        if (this.currentScreenshot) {
            fd.append('screenshot', this.base64ToBlob(this.currentScreenshot));
        }
        await fetch(getApiUrl('feedback'), {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + token
            },
            body: fd,
        });
        document.getElementById('pt-content').style.display = 'none';
        document.getElementById('pt-success').style.display = 'block';
        setTimeout(() => {
            this.toggleFeedbackWindow();
            this.resetForm();
        }, 2000);
    }
    resetForm() {
        document.getElementById('pt-text').value = '';
        this.removeScreenshot();
        document.getElementById('pt-content').style.display = 'block';
        document.getElementById('pt-success').style.display = 'none';
    }
    createButton() {
        const btn = document.createElement('button');
        btn.className = 'pt-btn';
        btn.style.cssText = this.getPositionStyle();
        btn.textContent = this.config.buttonText;
        btn.onclick = () => this.toggleFeedbackWindow();
        this.container = btn;
        document.body.appendChild(btn);
    }
    createFeedbackWindow() {
        const el = document.createElement('div');
        el.className = 'pt-window';
        el.style.cssText = this.getPositionStyle();
        el.innerHTML = `
      <div class="pt-header">
        <h3>Feedback</h3>
        <p>Ayúdanos a mejorar</p>
        <button id="pt-close" class="pt-close">✕</button>
      </div>

      <div class="pt-body">
        <div id="pt-success" class="pt-success">Gracias por tu feedback</div>

        <div id="pt-content">
          <div id="pt-options" class="pt-options">
            <button id="pt-suggest">Sugerencia</button>
            <button id="pt-error">Error</button>
          </div>

          <div id="pt-selected"></div>

          <textarea
            id="pt-text"
            placeholder="Cuéntanos con detalle..."
          ></textarea>

          <button id="pt-shot-btn" class="pt-secondary">
            Capturar pantalla
          </button>

          <div id="pt-shot">
            <img id="pt-shot-img"/>
            <button id="pt-shot-remove" class="pt-link">Quitar captura</button>
          </div>

          <button id="pt-submit" class="pt-primary">
            Enviar feedback
          </button>

          

          <div class="pt-footer">
            Powered by <strong><a href="https://rojastudio.xyz" target="_blank">PulseTrack</a></strong>
          </div>
        </div>
      </div>
    `;
        const suggestBtn = el.querySelector('#pt-suggest');
        const errorBtn = el.querySelector('#pt-error');
        const shotBtn = el.querySelector('#pt-shot-btn');
        const shotRemoveBtn = el.querySelector('#pt-shot-remove');
        const submitBtn = el.querySelector('#pt-submit');
        const closeBtn = el.querySelector('#pt-close');
        if (suggestBtn)
            suggestBtn.onclick = () => this.setFeedbackType('suggested');
        if (errorBtn)
            errorBtn.onclick = () => this.setFeedbackType('error');
        if (shotBtn)
            shotBtn.onclick = () => this.captureScreenshot();
        if (shotRemoveBtn)
            shotRemoveBtn.onclick = () => this.removeScreenshot();
        if (submitBtn)
            submitBtn.onclick = () => this.submitFeedback();
        if (closeBtn)
            closeBtn.onclick = () => this.toggleFeedbackWindow();
        this.feedbackWindow = el;
        document.body.appendChild(el);
    }
    addStyles() {
        if (document.getElementById('pt-styles'))
            return;
        const s = document.createElement('style');
        s.id = 'pt-styles';
        s.textContent = `
      .pt-btn{
        position:fixed;z-index:999999;
        padding:12px 20px;border-radius:999px;
        background:${this.config.themeColor};
        color:#fff;font-weight:600;border:none;
        box-shadow:0 10px 25px rgba(0,0,0,.2);
        cursor:pointer;
      }
      .pt-window{
        position:fixed;z-index:999999;
        width:360px;background:#fff;
        border-radius:16px 16px 0 0;
        transform:translateY(120%);
        transition:.25s;
        box-shadow:0 -10px 30px rgba(0,0,0,.15);
        font-family:system-ui;
      }
      .pt-window.pt-open{transform:translateY(0)}
      .pt-header{padding:16px;border-bottom:1px solid #eee;position:relative}
      .pt-header h3{margin:0;font-size:18px}
      .pt-header p{margin:4px 0 0;color:#666;font-size:13px}

      .pt-close{
        position:absolute;
        top:10px;
        right:12px;
        background:none;
        border:none;
        font-size:18px;
        cursor:pointer;
        color:#666;
      }

      .pt-body{padding:16px}
      .pt-options{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .pt-options button{padding:10px;border-radius:8px;border:1px solid #ddd}

      textarea{
        width:100%;
        margin-top:10px;
        padding:12px;
        border-radius:8px;
        border:1px solid #ddd;
        min-height:140px;
        resize:none;
      }

      .pt-primary{
        margin-top:12px;
        width:100%;
        padding:12px;
        border-radius:10px;
        background:${this.config.themeColor};
        color:#fff;
        font-weight:600;
        border:none;
        cursor:pointer;
      }

      .pt-secondary{
        margin-top:10px;
        font-size:12px;
        color: #666;
        cursor:pointer;
      }

      #pt-shot-remove{
        margin-top:10px;
        font-size:12px;
        color: #aa0a0aff;
        cursor:pointer;
      }
        
      .pt-link{
        background:none;
        border:none;
        color:#666;
        margin-top:6px;
        cursor:pointer;
      }

      .pt-badge{
        display:flex;
        justify-content:space-between;
        padding:8px;
        border-radius:8px;
        margin:8px 0
      }
      .pt-badge.error{background:#fee2e2;color:#991b1b}
      .pt-badge.suggested{background:#dbeafe;color:#1e40af}
      .pt-success{text-align:center;font-weight:600;display:none;margin:10em 0em;}

      #pt-shot{display:none;margin-top:8px}
      #pt-shot img{
        width:30%;
        max-height:220px;
        object-fit:contain;
        border-radius:8px;
        border:1px solid #e5e7eb;
      }

      .pt-footer{
        margin-top:12px;
        padding-top:10px;
        border-top:1px solid #eee;
        font-size:12px;
        text-align:center;
        color:#888;
      }
    `;
        document.head.appendChild(s);
    }
}
function Feedback(config) {
    return new FeedbackWidget(config);
}

class Nps {
    constructor(config) {
        this.hasVoted = false;
        if (!config.tracker)
            throw new Error('NPS requires tracker');
        this.tracker = config.tracker;
        this.config = {
            question: '¿Qué tan probable es que recomiendes este servicio?',
            themeColor: '#2563eb',
            position: 'bottom-center',
            autoShow: false,
            delay: 2000,
            mode: 'manual',
            ...config,
        };
        this.init();
    }
    init() {
        this.applyRemoteConfig();
        if (this.config.autoShow) {
            setTimeout(() => this.renderWidget(), this.config.delay || 0);
        }
    }
    applyRemoteConfig() {
        if (this.config.mode !== 'remote')
            return;
        getConfig();
        // const remoteNps = globalConfig?.remote?.nps;
        // if (!remoteNps?.enabled) return;
        // this.config.question = this.config.question || remoteNps.question;
        // this.config.themeColor = this.config.themeColor || remoteNps.themeColor;
        // this.config.position = this.config.position || remoteNps.position;
        // this.config.autoShow =
        //   this.config.autoShow ?? remoteNps.autoShow ?? false;
        // this.config.delay =
        //   this.config.delay ?? remoteNps.delay ?? 2000;
    }
    renderWidget() {
        if (document.getElementById('pt-nps-widget'))
            return;
        this.container = document.createElement('div');
        this.container.id = 'pt-nps-widget';
        this.container.innerHTML = this.getStep1Template();
        this.applyStyles();
        document.body.appendChild(this.container);
        this.attachStep1Listeners();
    }
    /* ---------------- STEP 1 ---------------- */
    getStep1Template() {
        return `
      <div class="nps-card">
        <button class="nps-close">×</button>
        <h3 class="nps-question">${this.config.question}</h3>
        <div class="nps-options">
          ${Array.from({ length: 10 }, (_, i) => `<button class="nps-btn" data-score="${i + 1}">${i + 1}</button>`).join('')}
        </div>
        <p class="nps-footer">1 = Nada probable, 10 = Muy probable</p>
        <p class="nps-footer powered">
          Powered by <a href="https://rojastudio.xyz" target="_blank">PulseTrack</a>
        </p>
      </div>
    `;
    }
    attachStep1Listeners() {
        const buttons = this.container.querySelectorAll('.nps-btn');
        buttons.forEach(btn => {
            btn.addEventListener('click', e => {
                const score = parseInt(e.target.dataset.score, 10);
                this.renderStep2(score);
            });
        });
        const close = this.container.querySelector('.nps-close');
        close?.addEventListener('click', () => this.close());
    }
    /* ---------------- STEP 2 ---------------- */
    renderStep2(score) {
        let title = '';
        let placeholder = '';
        if (score <= 6) {
            title = 'Lamentamos no haber cumplido tus expectativas 😞<br/>¿Qué podríamos mejorar?';
            placeholder = 'Tu sugerencia...';
        }
        else if (score <= 8) {
            title = 'Gracias por tu opinión 🙏<br/>¿Qué mejorarías?';
            placeholder = 'Tu comentario...';
        }
        else {
            title = '¡Gracias por recomendarnos! ❤️<br/>¿Te gustaría dejarnos tu correo?';
            placeholder = 'Tu mensaje...';
        }
        this.container.innerHTML = `
      <div class="nps-card">
        <button class="nps-close">×</button>
        <h3 class="nps-question">${title}</h3>

        ${`<input class="nps-input" type="email" placeholder="Tu correo (opcional)" />` }

        <textarea class="nps-text" rows="2" placeholder="${placeholder}" style="resize:none;"></textarea>

        <button class="nps-submit">Enviar</button>
      </div>
    `;
        this.applyStyles();
        this.container
            .querySelector('.nps-submit')
            ?.addEventListener('click', () => {
            const feedback = this.container.querySelector('.nps-text')?.value || '';
            const email = this.container.querySelector('.nps-input')?.value || '';
            this.submit(score, feedback, email);
        });
        this.container
            .querySelector('.nps-close')
            ?.addEventListener('click', () => this.close());
    }
    /* ---------------- SUBMIT ---------------- */
    async submit(score, feedback, email) {
        if (this.hasVoted)
            return;
        this.hasVoted = true;
        try {
            const endpoint = getApiUrl('nps');
            const payload = {
                score,
                feedback,
                email,
                // session_id: SessionStorageService.getSessionId(),
                // user_id: SessionStorageService.getUserId(),
                url: window.location.href,
                user_agent: navigator.userAgent,
                timestamp: new Date().toISOString(),
            };
            const { token } = getConfig();
            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + token,
                    },
                    body: JSON.stringify(payload),
                    keepalive: true
                });
                if (response.ok) {
                    this.showSuccessMessage();
                    return;
                }
            }
            catch (error) {
                console.error('Failed to send NPS with keepalive fetch:', error);
            }
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + token,
                },
                body: JSON.stringify(payload),
                credentials: 'include',
            });
            console.log('se envia');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            this.showSuccessMessage();
        }
        catch (err) {
            console.error('Error enviando NPS:', err);
            this.showErrorMessage();
        }
    }
    showSuccessMessage() {
        this.container.innerHTML = `
      <div class="nps-card">
        <p>¡Gracias por tu opinión! 🙌</p>
      </div>
    `;
        setTimeout(() => this.close(), 2500);
    }
    showErrorMessage() {
        this.container.innerHTML = `
      <div class="nps-card">
        <p>Ocurrió un error al enviar tu opinión. Por favor, inténtalo de nuevo más tarde.</p>
        <button class="nps-submit" style="margin-top: 10px;">Cerrar</button>
      </div>
    `;
        const closeBtn = this.container.querySelector('.nps-submit');
        closeBtn?.addEventListener('click', () => this.close());
    }
    /* ---------------- STYLES ---------------- */
    applyStyles() {
        if (document.getElementById('pt-nps-styles'))
            return;
        const style = document.createElement('style');
        style.id = 'pt-nps-styles';
        style.textContent = `
      #pt-nps-widget {
        position: fixed;
        ${this.getPosition()};
        z-index: 999999;
        font-family: system-ui, sans-serif;
      }

      .nps-card {
        background: #fff;
        border-radius: 12px;
        padding: 16px;
        width: 300px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.15);
        position: relative;
        animation: fadeIn 0.25s ease-out;
      }

      .nps-close {
        position: absolute;
        top: 6px;
        right: 8px;
        background: none;
        border: none;
        font-size: 18px;
        cursor: pointer;
      }

      .nps-question {
        font-weight: 600;
        margin-bottom: 12px;
        color: #374151;
        font-size: 15px;
      }

      .nps-options {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
      }

      .nps-btn {
        flex: 1;
        padding: 6px 0;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        background: #fff;
        cursor: pointer;
      }

      .nps-btn:hover {
        background: ${this.config.themeColor};
        border-color: ${this.config.themeColor};
        color: #fff;
      }

      .nps-text, .nps-input {
        width: 100%;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        padding: 8px;
        margin-bottom: 8px;
      }

      .nps-submit {
        width: 100%;
        background: ${this.config.themeColor};
        color: #fff;
        border: none;
        border-radius: 8px;
        padding: 8px 0;
        font-weight: 600;
        cursor: pointer;
      }

      .nps-footer {
        font-size: 12px;
        color: #6b7280;
        text-align: center;
        margin-top: 10px;
      }

      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(15px); }
        to { opacity: 1; transform: translateY(0); }
      }
    `;
        document.head.appendChild(style);
    }
    getPosition() {
        switch (this.config.position) {
            case 'bottom-left': return 'bottom: 20px; left: 20px;';
            case 'bottom-center': return 'bottom: 20px; left: 50%; transform: translateX(-50%);';
            case 'top-right': return 'top: 20px; right: 20px;';
            case 'top-left': return 'top: 20px; left: 20px;';
            default: return 'bottom: 20px; right: 20px;';
        }
    }
    /* ---------------- PUBLIC ---------------- */
    open() {
        this.renderWidget();
    }
    close() {
        this.container?.remove();
    }
}

class ApiError extends Error {
    constructor(message, status, data = null) {
        super(message);
        this.status = status;
        this.data = data;
        this.name = 'ApiError';
        Object.setPrototypeOf(this, ApiError.prototype);
    }
}
const API_BASE_URL = getApiUrl('');
async function fetchInitConfig(token) {
    try {
        const DEFAULT_HEADERS = {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'Authorization': `Bearer ${token}`
        };
        const response = await fetch(`${API_BASE_URL}/init`, {
            method: 'GET',
            headers: { ...DEFAULT_HEADERS },
            credentials: 'include',
            mode: 'cors',
        });
        let responseData = null;
        // Only try to parse JSON if there's content
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
            try {
                responseData = await response.json();
            }
            catch (error) {
                console.warn('Failed to parse JSON response', error);
            }
        }
        if (!response.ok) {
            const errorData = responseData;
            throw new ApiError(errorData?.message || response.statusText || 'Failed to fetch configuration', response.status, responseData);
        }
        return {
            data: responseData,
            error: null,
            status: response.status,
            ok: true,
        };
    }
    catch (error) {
        const normalizedError = error instanceof Error
            ? error
            : new Error('An unknown error occurred');
        return {
            data: null,
            error: normalizedError,
            status: error instanceof ApiError ? error.status : null,
            ok: false,
        };
    }
}

let tracker = null;
let initializationPromise = null;
let remoteResponse;
const ensureInitialized = () => {
    if (!tracker) {
        throw new Error('PulseTrack not initialized. Call PulseTrack.init() first.');
    }
};
const PulseTrack = {
    async init(config) {
        if (initializationPromise) {
            console.warn('PulseTrack already initializing');
            return initializationPromise;
        }
        initializationPromise = (async () => {
            try {
                console.log('Starting PulseTrack initialization...');
                if (config.remote) {
                    console.log('Fetching remote configuration...');
                    const response = await fetchInitConfig(config.token);
                    if (response.ok) {
                        console.log('Remote config received:', response.data);
                        remoteResponse = response.data;
                        config = { ...config, ...response.data };
                    }
                    else {
                        console.warn('Failed to fetch remote config:', response.error?.message);
                    }
                }
                console.log('Initializing with config:', config);
                const initializedConfig = initConfig(config);
                console.log('Configuration initialized');
                tracker = new SystemTracker(initializedConfig);
                await tracker.start();
                console.log('PulseTrack initialization completed successfully');
                return initializedConfig;
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                console.error('Failed to initialize PulseTrack:', errorMessage);
                console.error(error);
                throw error;
            }
        })();
        return initializationPromise;
    },
    async ensureReady() {
        if (initializationPromise) {
            await initializationPromise;
        }
        else {
            throw new Error('PulseTrack not initialized. Call PulseTrack.init() first.');
        }
    },
    tracker() {
        ensureInitialized();
        return tracker;
    },
    async Feedback(options) {
        await this.ensureReady();
        let data = remoteResponse.data.feedback;
        if (options)
            data = options;
        return Feedback({ tracker: this.tracker(), ...data });
    },
    async Announcement(options) {
        await this.ensureReady();
        let data = remoteResponse.data.announcements;
        if (options)
            data = options;
        return new Announcement({ tracker: this.tracker(), ...data });
    },
    async Nps(options) {
        await this.ensureReady();
        let data = remoteResponse.data.nps;
        if (options)
            data = options;
        return new Nps({ tracker: this.tracker(), ...data });
    },
};

exports.PulseTrack = PulseTrack;
