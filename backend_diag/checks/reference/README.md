# Frozen model catalog golden

`model-golden.json` was generated from the pre-TypeScript Python implementation of the model catalog and is now frozen. The Python reference copy and its generator have been removed, so the fixture can no longer be regenerated. All inputs are synthetic; it covers UTC, Asia/Tokyo, and America/New_York local-calendar behavior, including a daylight-saving transition in the 240-day window.

Run the parity checks with Node only:

    node --test backend_diag/checks/model-parity.check.mjs

Do not overwrite the expectations with output from the TypeScript implementation under test. When `backend_server/conf/conf_model.py` changes intentionally, add new synthetic cases to `checks/model-catalog.check.mjs` instead.
