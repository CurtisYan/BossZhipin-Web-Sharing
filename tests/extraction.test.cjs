const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Exercise production helpers without starting extension UI or Chrome listeners.
function load() {
  const source = fs.readFileSync(require('node:path').join(__dirname, '../content.js'), 'utf8');
  const context = {
    window: { innerWidth: 1400, innerHeight: 800 },
    location: { pathname: '/web/geek/jobs', href: 'https://www.zhipin.com/web/geek/jobs', hostname: 'www.zhipin.com' },
    document: {}, URL, Node: { ELEMENT_NODE: 1 },
    chrome: { runtime: { getManifest: () => ({ version: 'test' }) } },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1', fontSize: '24', fontWeight: '700', position: 'static' })
  };
  const start = source.indexOf('  chrome.runtime.onMessage.addListener');
  const end = source.indexOf('  function injectFloatingButton()');
  vm.runInNewContext(source.slice(0, start) + '\n globalThis.api = { jobFieldScope, pickJobHeaderSnapshot, metaFromParts, isCityMeta, findDetailPageUrl, pickRecruiter, completeMetaCity, buildMobileShareMeta };\n' + source.slice(end), context);
  return context;
}
function node(text = '容器', left = 525, top = -590) {
  return {
    nodeType: 1, innerText: text, textContent: text, className: '', children: [],
    getBoundingClientRect: () => ({ left, right: left + 740, top, bottom: top + 60, width: 740, height: 60 }),
    querySelectorAll(selector) { return this.queries?.[selector] || []; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    contains(other) { return this === other || this.children.some(c => c.contains(other)); },
    closest() { return this.parentElement || null; }
  };
}
function fixture() {
  const ctx = load();
  const body = node(), mixed = node(), panel = node(), root = node('职位描述'), header = node('数据开发实习生 160-180元/天');
  const title = node('数据开发实习生');
  const unrelated = node('数据分析师（全职 + 实习） 5-9K 深圳派投文化有限公司 深圳·南山区·蛇口', 20, 0);
  body.children = [mixed]; mixed.parentElement = body;
  mixed.children = [unrelated, panel]; panel.parentElement = mixed;
  panel.children = [header, root]; root.parentElement = panel; header.parentElement = panel;
  header.queries = { h1: [title] };
  panel.queries = { '.job-header': [header] };
  mixed.queries = { '.job-card-wrapper, .job-card-box, .job-list-box, .job-list': [unrelated] };
  body.queries = { '.job-header': [unrelated, header] };
  ctx.document = Object.assign(body, { body });
  return { ctx, body, panel, root, header, unrelated };
}
test('scrolled list detail selects its sibling header, never a left-hand job', () => {
  const { ctx, root, panel } = fixture();
  assert.equal(ctx.api.jobFieldScope(root), panel);
  const result = ctx.api.pickJobHeaderSnapshot(root);
  assert.equal(result.title, '数据开发实习生');
  assert.equal(result.salary, '160-180元/天');
});
test('company names are not city metadata; internship requirements survive', () => {
  const { api } = load();
  const meta = api.metaFromParts(['深圳派投文化有限公司', '东莞', '5天/周', '6个月', '本科']);
  assert.equal(meta.city, '东莞');
  assert.equal(meta.experience, '5天/周');
  assert.equal(meta.degree, '本科');
  assert.deepEqual(Array.from(meta.parts), ['东莞', '5天/周', '6个月', '本科']);
  assert.equal(api.isCityMeta('深圳·南山区·蛇口'), true);
  assert.equal(api.isCityMeta('深圳市'), true);
  assert.equal(api.isCityMeta('深圳派投文化有限公司'), false);
});
function link(title, id) {
  const result = node(title, 20, 0);
  result.getAttribute = () => `/job_detail/${id}.html`;
  return result;
}
test('URL rejects unrelated jobs and ambiguous same-title jobs', () => {
  const { ctx, body, root } = fixture();
  const a = link('其他职位', 'wrong');
  body.queries["a[href*='/job_detail/']"] = [a];
  assert.equal(ctx.api.findDetailPageUrl('数据开发实习生', root), '');
  const b = link('数据开发实习生', 'correct');
  body.queries["a[href*='/job_detail/']"] = [a, b];
  assert.equal(ctx.api.findDetailPageUrl('数据开发实习生', root), 'https://www.zhipin.com/job_detail/correct.html');
  body.queries["a[href*='/job_detail/']"].push(link('数据开发实习生', 'duplicate'));
  assert.equal(ctx.api.findDetailPageUrl('数据开发实习生', root), '');
});
test('standalone detail keeps document header and canonical URL', () => {
  const { ctx, body, root, header } = fixture();
  ctx.location.pathname = '/job_detail/correct.html';
  ctx.location.href = 'https://www.zhipin.com/job_detail/correct.html?securityId=test';
  body.queries['.job-header'] = [header];
  assert.equal(ctx.api.jobFieldScope(root), body);
  assert.equal(ctx.api.pickJobHeaderSnapshot(root).salary, '160-180元/天');
  assert.equal(ctx.api.findDetailPageUrl('数据开发实习生', root), 'https://www.zhipin.com/job_detail/correct.html');
});

for (const pathname of ['/web/geek/jobs', '/job_detail/example.html']) {
  test(`recruiter real name and city complete on ${pathname}`, () => {
    const ctx = load();
    ctx.location.pathname = pathname;
    const root = node();
    root.queries = { '.boss-info h2': [node('杨洁彪 刚刚活跃')] };
    assert.equal(ctx.api.pickRecruiter(root, ['杨洁彪', '刚刚活跃', '飞数方程 · 经理']), '杨洁彪');
    root.queries = {};
    assert.equal(ctx.api.pickRecruiter(root, ['职位描述', '杨洁彪', '刚刚活跃', '飞数方程 · 经理']), '杨洁彪');
    assert.equal(ctx.api.pickRecruiter(root, ['飞数方程 · 经理', '经理']), '');
    assert.equal(ctx.api.pickRecruiter(root, ['杨洁彪', '刚刚活跃', '飞数方程 ·', '经理']), '杨洁彪');
    assert.equal(ctx.api.pickRecruiter(root, ['黄女士', '在线', '广东仙津 · 招聘主任']), '黄女士');
    const meta = ctx.api.metaFromParts(['5天/周', '5个月', '本科']);
    ctx.api.completeMetaCity(meta, '广州天河区富誉汇·众创1号410');
    assert.equal(meta.city, '广州');
    assert.equal(ctx.api.buildMobileShareMeta({ ...meta, metaParts: meta.parts, salary: '120-170元/天', isIntern: true }).join('/'), '广州/120-170元/天/5天/周/5个月/本科');
  });
}
test('city fallback preserves existing city and leaves unknown addresses empty', () => {
  const { api } = load();
  const known = api.metaFromParts(['东莞', '本科']);
  api.completeMetaCity(known, '广州天河区富誉汇');
  assert.equal(known.city, '东莞');
  const unknown = api.metaFromParts(['本科']);
  api.completeMetaCity(unknown, '面试沟通');
  assert.equal(unknown.city, '');
});
