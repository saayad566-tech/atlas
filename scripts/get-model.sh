#!/usr/bin/env bash
# Fetch a local model so the assistant can answer with a real language model.
# Usage: scripts/get-model.sh [model-id]
set -euo pipefail
cd "$(dirname "$0")/.."
MODEL="${1:-qwen2.5-0.5b-q4}"
DEST="${ATLAS_MODELS_DIR:-data/models}"
mkdir -p "$DEST"
node -e "
const {downloadModel}=require('./dist/finance/core/modeldownload');
(async()=>{
  const id=process.argv[1], dir=process.argv[2];
  console.log('downloading', id, 'into', dir);
  const r=await downloadModel(id, dir);
  if (r.state!=='done') { console.error('failed:', r.error); process.exit(1); }
  console.log('ready:', r.file, (r.bytes/1e6).toFixed(0)+'MB');
  console.log('start Atlas with: ATLAS_MODEL_PATH='+r.file+' npm start');
})();
" "$MODEL" "$DEST"
