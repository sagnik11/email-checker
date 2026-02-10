function badRequest(res, message) {
  return res.status(400).json({ error: String(message) });
}

function internalError(res, err) {
  return res.status(500).json({ error: err?.message || String(err) });
}

module.exports = {
  badRequest,
  internalError,
};
