"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpecValidationError = exports.ConfigError = void 0;
class ConfigError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ConfigError';
    }
}
exports.ConfigError = ConfigError;
class SpecValidationError extends Error {
    specPath;
    issues;
    constructor(specPath, issues) {
        super(`Invalid OpenAPI spec "${specPath}" (${issues.length} issue(s)):\n` +
            issues.map((issue) => `  - ${issue}`).join('\n'));
        this.specPath = specPath;
        this.issues = issues;
        this.name = 'SpecValidationError';
    }
}
exports.SpecValidationError = SpecValidationError;
//# sourceMappingURL=errors.js.map