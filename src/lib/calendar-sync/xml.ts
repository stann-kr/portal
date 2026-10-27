/**
 * WebDAV multistatus용 최소 namespace-aware XML parser (Workers에는 DOMParser가 없다).
 * 지원: element, attribute, namespace prefix scope, text, CDATA, 기본·숫자 entity, comment, PI.
 * 거부: DOCTYPE·ENTITY 등 모든 `<!` 선언(XXE), 미정의 entity, 미바인딩 prefix, 깊이·크기 초과.
 */

export const DAV_NS = "DAV:";
export const CALDAV_NS = "urn:ietf:params:xml:ns:caldav";
export const CALENDARSERVER_NS = "http://calendarserver.org/ns/";
export const APPLE_ICAL_NS = "http://apple.com/ns/ical/";
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const XMLNS_NS = "http://www.w3.org/2000/xmlns/";

export const XML_MAX_LENGTH = 5 * 1024 * 1024;
export const XML_MAX_DEPTH = 64;

export class XmlParseError extends Error {}

export type XmlElement = {
  /** namespace URI("" = 없음) */
  ns: string;
  /** local name */
  name: string;
  /** key: 무namespace attribute는 local name, namespace attribute는 `{uri}local`. */
  attributes: Record<string, string>;
  children: XmlElement[];
  /** 이 element의 직접 text(CDATA 포함)를 이어 붙인 값. */
  text: string;
};

const NAME_START = /[A-Za-z_À-￿]/u;
const NAME_CHAR = /[A-Za-z0-9_.\-:·À-￿]/u;

function decodeEntities(raw: string): string {
  if (!raw.includes("&")) return raw;
  return raw.replace(/&([^;&\s]{0,32});?/gu, (match, body: string) => {
    if (!match.endsWith(";")) throw new XmlParseError("Malformed entity reference");
    switch (body) {
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "amp":
        return "&";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default: {
        const numeric = /^#(?:x([0-9A-Fa-f]{1,6})|([0-9]{1,7}))$/u.exec(body);
        if (!numeric) throw new XmlParseError("Unknown entity reference");
        const codePoint = numeric[1] !== undefined ? Number.parseInt(numeric[1], 16) : Number.parseInt(numeric[2], 10);
        if (
          codePoint === 0 ||
          codePoint > 0x10ffff ||
          (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ) {
          throw new XmlParseError("Invalid character reference");
        }
        return String.fromCodePoint(codePoint);
      }
    }
  });
}

type RawAttribute = { qname: string; value: string };
type Frame = { element: XmlElement; qname: string; scope: Map<string, string> };

function splitQName(qname: string): { prefix: string; local: string } {
  const index = qname.indexOf(":");
  if (index === -1) return { prefix: "", local: qname };
  if (index === 0 || index === qname.length - 1 || qname.indexOf(":", index + 1) !== -1) {
    throw new XmlParseError("Invalid qualified name");
  }
  return { prefix: qname.slice(0, index), local: qname.slice(index + 1) };
}

export function parseXml(input: string, options: { maxLength?: number; maxDepth?: number } = {}): XmlElement {
  const maxLength = options.maxLength ?? XML_MAX_LENGTH;
  const maxDepth = options.maxDepth ?? XML_MAX_DEPTH;
  if (typeof input !== "string" || input.length > maxLength) throw new XmlParseError("XML is too large");
  const source = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const length = source.length;
  const rootScope = new Map<string, string>([["xml", XML_NS]]);
  const stack: Frame[] = [];
  let root: XmlElement | null = null;
  let position = 0;

  const fail = (message: string): never => {
    throw new XmlParseError(message);
  };

  const readName = (): string => {
    const start = position;
    if (position >= length || !NAME_START.test(source[position])) fail("Invalid name");
    position += 1;
    while (position < length && NAME_CHAR.test(source[position])) position += 1;
    return source.slice(start, position);
  };

  const skipWhitespace = () => {
    while (position < length && /\s/u.test(source[position])) position += 1;
  };

  const appendText = (text: string) => {
    if (!text) return;
    const top = stack[stack.length - 1];
    if (!top) {
      if (/\S/u.test(text)) fail("Text outside root element");
      return;
    }
    top.element.text += text;
  };

  while (position < length) {
    const next = source.indexOf("<", position);
    if (next === -1) {
      appendText(decodeEntities(source.slice(position)));
      position = length;
      break;
    }
    if (next > position) {
      const raw = source.slice(position, next);
      if (raw.includes("]]>")) fail("Unexpected CDATA terminator");
      appendText(decodeEntities(raw));
    }
    position = next;

    if (source.startsWith("<?", position)) {
      const end = source.indexOf("?>", position + 2);
      if (end === -1) fail("Unterminated processing instruction");
      position = end + 2;
      continue;
    }
    if (source.startsWith("<!--", position)) {
      const end = source.indexOf("-->", position + 4);
      if (end === -1) fail("Unterminated comment");
      position = end + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", position)) {
      const end = source.indexOf("]]>", position + 9);
      if (end === -1) fail("Unterminated CDATA");
      if (stack.length === 0) fail("CDATA outside root element");
      appendText(source.slice(position + 9, end));
      position = end + 3;
      continue;
    }
    if (source.startsWith("<!", position)) {
      // DOCTYPE, ENTITY, ELEMENT, ATTLIST 등 모든 선언을 거부한다(XXE·billion laughs).
      fail("XML declarations are not allowed");
    }
    if (source.startsWith("</", position)) {
      position += 2;
      const qname = readName();
      skipWhitespace();
      if (source[position] !== ">") fail("Malformed end tag");
      position += 1;
      const top = stack.pop();
      if (!top || top.qname !== qname) fail("Mismatched end tag");
      continue;
    }

    // start tag
    position += 1;
    const qname = readName();
    const rawAttributes: RawAttribute[] = [];
    let selfClosing = false;
    while (true) {
      const before = position;
      skipWhitespace();
      if (position >= length) fail("Unterminated start tag");
      if (source[position] === ">") {
        position += 1;
        break;
      }
      if (source.startsWith("/>", position)) {
        position += 2;
        selfClosing = true;
        break;
      }
      if (position === before) fail("Attributes must be separated by whitespace");
      const attributeName = readName();
      skipWhitespace();
      if (source[position] !== "=") fail("Attribute without value");
      position += 1;
      skipWhitespace();
      const quote = source[position];
      if (quote !== '"' && quote !== "'") fail("Attribute value must be quoted");
      const end = source.indexOf(quote, position + 1);
      if (end === -1) fail("Unterminated attribute value");
      const rawValue = source.slice(position + 1, end);
      if (rawValue.includes("<")) fail("Invalid attribute value");
      if (rawAttributes.some((attribute) => attribute.qname === attributeName)) fail("Duplicate attribute");
      rawAttributes.push({ qname: attributeName, value: decodeEntities(rawValue) });
      position = end + 1;
    }

    if (stack.length === 0 && root) fail("Multiple root elements");
    if (stack.length >= maxDepth) fail("XML is too deep");

    const parentScope = stack[stack.length - 1]?.scope ?? rootScope;
    let scope = parentScope;
    for (const attribute of rawAttributes) {
      if (attribute.qname === "xmlns" || attribute.qname.startsWith("xmlns:")) {
        if (scope === parentScope) scope = new Map(parentScope);
        if (attribute.qname === "xmlns") {
          scope.set("", attribute.value);
        } else {
          const prefix = attribute.qname.slice(6);
          if (!prefix || prefix === "xmlns" || (prefix === "xml" && attribute.value !== XML_NS)) fail("Invalid namespace declaration");
          if (!attribute.value) fail("Empty namespace prefix binding");
          scope.set(prefix, attribute.value);
        }
      }
    }

    const { prefix, local } = splitQName(qname);
    const ns = prefix ? scope.get(prefix) : scope.get("") ?? "";
    if (ns === undefined) fail("Unbound namespace prefix");

    const attributes: Record<string, string> = {};
    for (const attribute of rawAttributes) {
      if (attribute.qname === "xmlns" || attribute.qname.startsWith("xmlns:")) {
        attributes[`{${XMLNS_NS}}${attribute.qname === "xmlns" ? "xmlns" : attribute.qname.slice(6)}`] = attribute.value;
        continue;
      }
      const parts = splitQName(attribute.qname);
      if (!parts.prefix) {
        attributes[parts.local] = attribute.value;
        continue;
      }
      const attributeNs = scope.get(parts.prefix);
      if (attributeNs === undefined) fail("Unbound attribute prefix");
      const key = `{${attributeNs}}${parts.local}`;
      if (key in attributes) fail("Duplicate attribute");
      attributes[key] = attribute.value;
    }

    const element: XmlElement = { ns: ns as string, name: local, attributes, children: [], text: "" };
    const parent = stack[stack.length - 1];
    if (parent) parent.element.children.push(element);
    else root = element;
    if (!selfClosing) stack.push({ element, qname, scope });
  }

  if (stack.length > 0) fail("Unclosed element");
  if (!root) fail("Missing root element");
  return root as XmlElement;
}

export function isElement(element: XmlElement | undefined, ns: string, name: string): boolean {
  return Boolean(element && element.ns === ns && element.name === name);
}

export function childElements(element: XmlElement | undefined, ns: string, name: string): XmlElement[] {
  return element ? element.children.filter((child) => child.ns === ns && child.name === name) : [];
}

export function childElement(element: XmlElement | undefined, ns: string, name: string): XmlElement | undefined {
  return element?.children.find((child) => child.ns === ns && child.name === name);
}

/** 경로를 따라 첫 element를 찾는다. 각 단계는 [ns, name]. */
export function pathElement(element: XmlElement | undefined, ...path: Array<[string, string]>): XmlElement | undefined {
  let current = element;
  for (const [ns, name] of path) current = childElement(current, ns, name);
  return current;
}

export function textContent(element: XmlElement | undefined): string {
  if (!element) return "";
  let result = element.text;
  for (const child of element.children) result += textContent(child);
  return result;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}
