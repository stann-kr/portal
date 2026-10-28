import assert from "node:assert/strict";
import test from "node:test";
import { CALDAV_NS, DAV_NS, XmlParseError, childElement, childElements, escapeXml, parseXml, textContent } from "./xml";

test("prefix·기본 namespace를 scope별로 해석하고 자식이 prefix를 다시 바인딩할 수 있다", () => {
  const root = parseXml(
    `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns="urn:default"><d:response><plain/><d:x xmlns:d="urn:other"><d:y/></d:x></d:response></d:multistatus>`,
  );
  assert.equal(root.ns, DAV_NS);
  assert.equal(root.name, "multistatus");
  const response = childElement(root, DAV_NS, "response");
  assert.ok(response);
  assert.equal(response.children[0].ns, "urn:default");
  assert.equal(response.children[0].name, "plain");
  const rebound = response.children[1];
  assert.equal(rebound.ns, "urn:other");
  assert.equal(rebound.children[0].ns, "urn:other");
});

test("xmlns=\"\"는 기본 namespace를 해제하고, 같은 local name도 namespace로 구분한다", () => {
  const root = parseXml(`<a xmlns="urn:a" xmlns:c="${CALDAV_NS}"><b xmlns=""/><c:b/><b/></a>`);
  assert.equal(root.children[0].ns, "");
  assert.equal(childElements(root, CALDAV_NS, "b").length, 1);
  assert.equal(childElements(root, "urn:a", "b").length, 1);
});

test("attribute namespace와 entity를 해석한다", () => {
  const root = parseXml(`<r xmlns:x="urn:x" name="VEVENT &amp; &quot;q&quot;" x:k='v&apos;'/>`);
  assert.equal(root.attributes.name, 'VEVENT & "q"');
  assert.equal(root.attributes["{urn:x}k"], "v'");
});

test("text의 기본·숫자 entity와 CDATA를 그대로 복원한다", () => {
  const root = parseXml(`<r>a &lt;b&gt; &amp; &#44;&#x1F600;&#xD55C;<![CDATA[<raw> & ]] text]]><i>z</i></r>`);
  assert.equal(root.text, "a <b> & ,😀한<raw> & ]] text");
  assert.equal(textContent(root), "a <b> & ,😀한<raw> & ]] textz");
});

test("주석과 PI는 건너뛰고 BOM을 허용한다", () => {
  const root = parseXml(`﻿<?xml version="1.0" encoding="utf-8"?><!-- c --><r><!-- inner --><?pi x?>t</r><!-- tail -->`);
  assert.equal(root.text, "t");
});

test("DOCTYPE·ENTITY 선언을 거부한다(XXE)", () => {
  assert.throws(
    () => parseXml(`<?xml version="1.0"?><!DOCTYPE r [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><r>&xxe;</r>`),
    XmlParseError,
  );
  assert.throws(() => parseXml(`<r><!ENTITY a "b"></r>`), XmlParseError);
  assert.throws(() => parseXml(`<!doctype r><r/>`), XmlParseError);
});

test("미정의 entity, 잘못된 구조, 미바인딩 prefix, 깊이 초과를 거부한다", () => {
  assert.throws(() => parseXml(`<r>&xxe;</r>`), XmlParseError);
  assert.throws(() => parseXml(`<r>a & b</r>`), XmlParseError);
  assert.throws(() => parseXml(`<r>&#0;</r>`), XmlParseError);
  assert.throws(() => parseXml(`<r><a></r>`), XmlParseError);
  assert.throws(() => parseXml(`<r></r><r2/>`), XmlParseError);
  assert.throws(() => parseXml(`<x:r/>`), XmlParseError);
  assert.throws(() => parseXml(`<r a="1" a="2"/>`), XmlParseError);
  assert.throws(() => parseXml(`<r a=1/>`), XmlParseError);
  assert.throws(() => parseXml(`<r>`), XmlParseError);
  assert.throws(() => parseXml(``), XmlParseError);
  assert.throws(() => parseXml(`text<r/>`), XmlParseError);
  assert.throws(() => parseXml(`${"<a>".repeat(70)}${"</a>".repeat(70)}`), XmlParseError);
  assert.throws(() => parseXml(`<r>${"a".repeat(100)}</r>`, { maxLength: 50 }), XmlParseError);
});

test("escapeXml은 parse와 왕복한다", () => {
  const value = `/cal/a&b <"x'>.ics`;
  assert.equal(parseXml(`<h>${escapeXml(value)}</h>`).text, value);
});
