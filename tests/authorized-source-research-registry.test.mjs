import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const registryPath = new URL('../data/authorized-source-research-registry.json', import.meta.url);
const guidePath = new URL('../docs/product/provider-research-registry.md', import.meta.url);
const deliveryPlanPath = new URL('../docs/product/delivery-plan.md', import.meta.url);

async function loadJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

test('authorized source research registry satisfies the seed requirements', async () => {
  const registry = await loadJson(registryPath);

  assert.equal(registry.version, 1);
  assert.match(registry.lastReviewed, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(registry.orderingPolicy.freeDirectFirst, true);
  assert.equal(registry.orderingPolicy.beatportLastResortPaidFallback, true);
  assert.ok(
    Array.isArray(registry.orderingPolicy.disallowedApproaches) &&
      registry.orderingPolicy.disallowedApproaches.includes('stream-ripping'),
  );

  assert.ok(Array.isArray(registry.sources));
  assert.ok(registry.sources.length >= 5);

  const ids = new Set();
  for (const source of registry.sources) {
    assert.ok(source.id);
    assert.ok(!ids.has(source.id), `duplicate source id: ${source.id}`);
    ids.add(source.id);

    assert.ok(source.name);
    assert.ok(source.scopeDecision);
    assert.ok(source.scopeRationale);
    assert.ok(source.implementationBucket);
    assert.ok(Number.isInteger(source.priorityRank));
    assert.ok(source.authorizationRationale);
    assert.ok(source.acquisitionMode);
    assert.ok(source.automationApproach);
    assert.ok(source.automationConfidence);
    assert.ok(Array.isArray(source.supportedFormats) && source.supportedFormats.length > 0);
    assert.ok(source.djElectronicFit);
    assert.ok(Array.isArray(source.notableRisks) && source.notableRisks.length > 0);
    assert.ok(Array.isArray(source.officialReferences) && source.officialReferences.length > 0);
  }

  const beatport = registry.sources.find((source) => source.id === 'beatport');
  assert.ok(beatport, 'Beatport must be present');
  assert.equal(beatport.scopeDecision, 'required-fallback');
  assert.equal(beatport.implementationBucket, 'paid-review-queue');

  const freeCandidates = registry.sources.filter(
    (source) => source.implementationBucket === 'free-auto',
  );
  assert.ok(freeCandidates.length >= 2, 'expected multiple free/direct candidates');
});

test('provider research documentation explains registry usage and ordering', async () => {
  const [guide, deliveryPlan] = await Promise.all([
    readFile(guidePath, 'utf8'),
    readFile(deliveryPlanPath, 'utf8'),
  ]);

  assert.match(guide, /data\/authorized-source-research-registry\.json/);
  assert.match(guide, /free\/direct/i);
  assert.match(guide, /Beatport/i);
  assert.match(guide, /last-resort paid fallback/i);

  assert.match(deliveryPlan, /Authorized-Source Research Registry/i);
  assert.match(deliveryPlan, /data\/authorized-source-research-registry\.json/);
});
