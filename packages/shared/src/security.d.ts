import Joi from 'joi';
export declare const sanitizeInput: (input: string) => string;
export declare const sanitizeHTML: (html: string) => string;
export declare const validationSchemas: {
    username: Joi.StringSchema<string>;
    email: Joi.StringSchema<string>;
    roomCode: Joi.StringSchema<string>;
    tradeAmount: Joi.NumberSchema<number>;
    botCode: Joi.StringSchema<string>;
    message: Joi.StringSchema<string>;
};
export declare const validateInput: <T>(value: unknown, schema: Joi.Schema) => {
    isValid: boolean;
    data?: T;
    error?: string;
};
export declare const rateLimitConfig: {
    windowMs: number;
    max: number;
    message: string;
    standardHeaders: boolean;
    legacyHeaders: boolean;
};
export declare const endpointLimits: {
    auth: {
        windowMs: number;
        max: number;
        message: string;
    };
    trading: {
        windowMs: number;
        max: number;
        message: string;
    };
    bot: {
        windowMs: number;
        max: number;
        message: string;
    };
};
export declare const cspConfig: {
    directives: {
        defaultSrc: string[];
        scriptSrc: string[];
        styleSrc: string[];
        imgSrc: string[];
        connectSrc: string[];
        fontSrc: string[];
        objectSrc: string[];
        mediaSrc: string[];
        frameSrc: string[];
        upgradeInsecureRequests: string[];
    };
};
export declare const corsConfig: {
    origin: string[];
    credentials: boolean;
    optionsSuccessStatus: number;
    methods: string[];
    allowedHeaders: string[];
};
export declare const securityHeaders: Record<string, string>;
export declare const passwordSchema: Joi.StringSchema<string>;
export declare const sanitizeObject: (obj: unknown) => unknown;
export declare class RateLimiter {
    private attempts;
    checkLimit(identifier: string, maxAttempts: number, windowMs: number): boolean;
    reset(identifier: string): void;
    cleanup(): void;
}
export declare const globalRateLimiter: RateLimiter;
//# sourceMappingURL=security.d.ts.map