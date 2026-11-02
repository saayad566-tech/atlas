#!/usr/bin/env bash
# One command that proves the whole product. Exits non-zero if any suite fails.
set -u
cd "$(dirname "$0")/.."
fail=0
run() {
  local name="$1" file="$2"
  printf '%-10s ' "$name"
  if node "scripts/$file" >/tmp/atlas-$name.log 2>&1; then
    grep -E "PASSED" /tmp/atlas-$name.log | tail -1
  else
    echo "FAILED  (see /tmp/atlas-$name.log)"
    fail=1
  fi
}
echo "Atlas verification"
echo "------------------"
printf '%-10s ' "typecheck"
if node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit >/tmp/atlas-typecheck.log 2>&1; then
  echo "clean"
else
  echo "FAILED  (see /tmp/atlas-typecheck.log)"; fail=1
fi
node scripts/copy-assets.mjs >/dev/null
run deep      verify-deep.js
run universe  verify-universe.js
run ui        verify-ui.js
run prod      verify-prod.js
run import    verify-import.js
run pwa       verify-pwa.js
run markets   verify-markets.js
run bundles   verify-bundles.js
run indexes   verify-universe-sources.js
run integrity verify-integrity.js
run tabs      verify-tabs.js
run features  verify-features.js
run firstrun  verify-firstrun.js
run mkt-switch verify-market-switch.js
run models    verify-models.js
run charts    verify-charts.js
run indicators verify-indicators.js
run live      verify-live.js
run scheduler verify-scheduler.js
run multimkt  verify-multimarket.js
run enrich    verify-enrich.js
run extras    verify-extras.js
run briefing  verify-briefing.js
run journal   verify-journal.js
run discover  verify-discover.js
run peer-rank verify-peer-rank.js
run history   verify-history.js
run backtest  verify-backtest.js
run corporate verify-corporate.js
run datatruth verify-datatruth.js
run graph     verify-graph-strategy.js
run ask       verify-ask.js
run advisors  verify-advisors.js
run backdata  verify-backdata.js
run timestamps verify-timestamps.js
run resilient verify-resilience.js
run newsroom  verify-newsroom.js
run mkt-scope verify-market-scope.js
run provenance verify-provenance.js
run failover  verify-failover.js
run adapters  verify-adapters.js
run ratios    verify-ratios.js
run fundmtl   verify-fundamentals.js
run revdcf    verify-valuation-deep.js
run live-pipe verify-live-pipeline.js
run prelisting verify-prelisting.js
run events    verify-events.js
run bulk      verify-bulk.js
run isolation verify-isolation.js
run iso-guard verify-isolation-static.js
run query     verify-query.js
run userfeat  verify-userfeatures.js
run research  verify-research.js
run quality   verify-quality.js
run zip       verify-zip.js
run apk       verify-apk.js
echo "------------------"
if [ "$fail" -eq 0 ]; then echo "ALL SUITES PASSED"; else echo "SOME SUITES FAILED"; fi
exit "$fail"
