const fs = require("node:fs");
const path = require("node:path");

function readLines(filePath) {
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

const dataDir = path.join(__dirname, "..", "data");
const rolesSet = new Set(readLines(path.join(dataDir, "roles.txt")).map((x) => x.toLowerCase()));
const b2cSet = new Set(readLines(path.join(dataDir, "b2c.txt")).map((x) => x.toLowerCase()));
const rules = JSON.parse(fs.readFileSync(path.join(dataDir, "rules.json"), "utf8"));

module.exports = {
  b2cSet,
  rolesSet,
  rules,
};
