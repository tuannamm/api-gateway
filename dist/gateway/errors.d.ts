export declare class ConfigError extends Error {
    constructor(message: string);
}
export declare class SpecValidationError extends Error {
    readonly specPath: string;
    readonly issues: readonly string[];
    constructor(specPath: string, issues: readonly string[]);
}
