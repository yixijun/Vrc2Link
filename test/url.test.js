import assert from 'node:assert/strict';
import test from 'node:test';

import { extractId, identifyPlatform, normalizeSourceUrl } from '../src/utils/url.js';

test('extractId recognises hash-based Netease MV links', () => {
  const url = 'https://music.163.com/#/mv?id=5365570';

  assert.equal(identifyPlatform(url), 'netease');
  assert.deepEqual(extractId(url, 'netease'), { type: 'mv', id: '5365570' });
});

test('normalizeSourceUrl extracts a Bilibili URL from copied share text', () => {
  const shareText = '【杜比视界·全景声|超时空辉夜姬特别混音版「星降る海」~NERX Remix~】 https://www.bilibili.com/video/BV1W4PXzJEDy/?share_source=copy_web&vd_source=ca506b4a36411ffbeb99dd4bb414f924，要这种链接也能识别，自动去除中文啥的';

  const url = normalizeSourceUrl(shareText);

  assert.equal(identifyPlatform(url), 'bilibili');
  assert.deepEqual(extractId(url, 'bilibili'), { type: 'video', id: 'BV1W4PXzJEDy' });
});

test('normalizeSourceUrl removes copied prose after a short link', () => {
  assert.equal(
    normalizeSourceUrl('https://b23.tv/abcdef，复制到浏览器打开'),
    'https://b23.tv/abcdef',
  );
});

test('recognises Douyin and Kuaishou video links', () => {
  assert.equal(identifyPlatform('https://www.douyin.com/video/7341234567890123456'), 'douyin');
  assert.deepEqual(
    extractId('https://www.douyin.com/video/7341234567890123456', 'douyin'),
    { type: 'video', id: '7341234567890123456' },
  );
  assert.equal(identifyPlatform('https://www.kuaishou.com/short-video/3x7abc'), 'kuaishou');
  assert.deepEqual(
    extractId('https://www.kuaishou.com/short-video/3x7abc', 'kuaishou'),
    { type: 'video', id: '3x7abc' },
  );
  assert.deepEqual(extractId('https://v.douyin.com/abc123', 'douyin'), { type: 'video', id: 'abc123' });
  assert.deepEqual(extractId('https://v.kuaishou.com/abc123', 'kuaishou'), { type: 'video', id: 'abc123' });
});
