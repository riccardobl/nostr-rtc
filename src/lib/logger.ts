const isBrowser = typeof window !== "undefined";

export enum LogLevel {
    TRACE = 600,
    DEBUG = 500,
    INFO = 400,
    WARN = 300,
    ERROR = 200,
    FATAL = 100,
    OFF = 0,
}

export interface LogAttachment {
    log(logger: Logger, level: LogLevel, tags: string[], ...message: any[]): void;
}

export class ConsoleLogAttachment implements LogAttachment {
    private readonly level?: LogLevel;
    constructor(level?: LogLevel) {
        this.level = level;
    }
    public log(logger: Logger, level: LogLevel, tags: string[], ...message: any[]): void {
        if (this.level && level > this.level) return;

        let head = "";
        if (!isBrowser) {
            const date = new Date();
            const year = date.getFullYear();
            const month = ("0" + (date.getMonth() + 1)).slice(-2);
            const day = ("0" + date.getDate()).slice(-2);
            const hour = ("0" + date.getHours()).slice(-2);
            const minute = ("0" + date.getMinutes()).slice(-2);
            const second = ("0" + date.getSeconds()).slice(-2);
            head += `[${year}-${month}-${day} ${hour}:${minute}:${second}] `;
        }
        head += `[${logger.name}] `;
        if (!isBrowser) {
            head += `[${LogLevel[level]}] `;
        }

        const tail = tags.length ? `   ${tags.join(",")}` : "";
        if (level <= LogLevel.ERROR) {
            console.error(head, ...message, tail);
        } else if (level <= LogLevel.WARN) {
            console.warn(head, ...message, tail);
        } else if (level <= LogLevel.INFO) {
            console.info(head, ...message, tail);
        } else {
            console.log(head, ...message, tail);
        }
    }
}

export class JSONLogAttachment implements LogAttachment {
    private readonly endpoint: string;
    private readonly level?: LogLevel;
    private readonly authKey?: string;
    constructor(endpoint: string, authKey?: string, level?: LogLevel) {
        this.endpoint = endpoint;
        this.level = level;
        this.authKey = authKey;
    }

    public log(logger: Logger, level: LogLevel, tags: string[], ...message: any[]): void {
        if (this.level && level > this.level) return;

        const serialize = (m: any, seen: Set<any> = new Set()): string => {
            if (m) {
                if (seen.has(m)) {
                    return "[Circular]";
                }
                seen.add(m);
            }

            const type = typeof m;
            if (type === "function") {
                return m.toString() + "\n" + new Error().stack;
            } else if (type === "undefined") {
                return "undefined";
            } else if (m === null) {
                return "null";
            } else if (type === "string" || type === "number" || type === "bigint" || type === "boolean") {
                return String(m);
            } else if (m instanceof Error) {
                return (m.message || m.toString()) + "\n" + m.stack;
            } else if (m instanceof ArrayBuffer || m instanceof Uint8Array) {
                return "Buffer:" + Array.prototype.map.call(new Uint8Array(m), (x) => ("00" + x.toString(16)).slice(-2)).join("");
            } else if (type == "object" && Array.isArray(m)) {
                return JSON.stringify(m.map((x) => serialize(x, seen)));
            } else if (m instanceof Set) {
                return JSON.stringify(Array.from(m).map((x) => serialize(x, seen)));
            } else {
                try {
                    const str = m.toString();
                    if (!(str.startsWith("[object") && str.endsWith("]"))) {
                        return str;
                    }
                } catch (e) {
                    console.error(e);
                }
                const serializedObject: any = {};
                for (const key in m) {
                    if (Object.prototype.hasOwnProperty.call(m, key)) {
                        serializedObject[key] = serialize(m[key], seen);
                    }
                }
                return JSON.stringify(serializedObject);
            }
        };

        const logLevelStr: string = LogLevel[level];
        let endPoint = new URL(this.endpoint);
        if (this.authKey) {
            endPoint.searchParams.append("authKey", this.authKey);
        }
        fetch(endPoint.href, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                logger: logger.name,
                tags,
                level: logLevelStr,
                message: message.map((m) => serialize(m)).join(" "),
                createdAt: new Date().toISOString(),
            }),
        }).catch(() => {});
    }
}

/**
 * A logger.
 * Use debug, trace, info, warn, error, fatal to log messages unless you need to do some expensive computation to get the message,
 * in that case do it in a function you pass to debugLazy, traceLazy, infoLazy, warnLazy, errorLazy, fatalLazy
 * that will be called only if the log level is enabled.
 */
export class Logger {
    private readonly tags: string[] = [];
    private globalTags: { [key: string]: string } = {};
    private readonly attachments: LogAttachment[] = [];
    public readonly name: string;
    private readonly level: LogLevel;
    private readonly groupTags: string[] = [];

    constructor(name: string, level: LogLevel, tags: string[], globalTags?: { [key: string]: string }, groupTags?: string[]) {
        this.name = name;
        this.tags.push(...tags);
        this.globalTags = globalTags || {};
        this.level = level;
        if (groupTags) this.groupTags.push(...groupTags);
    }

    public addAttachment(attachment: LogAttachment) {
        this.attachments.push(attachment);
    }

    public group(label: string) {
        this.groupTags.push(label);
    }

    public groupEnd() {
        this.groupTags.pop();
    }

    public fork(label: string) {
        const logger = new Logger(this.name, this.level, [...this.tags], this.globalTags, [...this.groupTags, label]);
        for (const attachment of this.attachments) {
            logger.addAttachment(attachment);
        }
        return logger;
    }

    public log(level: LogLevel, ...message: any[]) {
        if (level > this.level) return;
        for (const attachment of this.attachments) {
            try {
                attachment.log(this, level, [...this.tags, ...this.groupTags, ...Object.entries(this.globalTags).map(([k, v]) => `${k}:${v}`)], ...message);
            } catch (e) {
                console.error("Error in log attachment", e);
            }
        }
    }

    public logLazy(level: LogLevel, func: () => any | Promise<any>) {
        if (typeof func !== "function") {
            throw new Error("lazy log needs a function to call");
        }

        if (level > this.level) return;

        try {
            const res: any = func();

            const _log = (message: any) => {
                message = Array.isArray(message) ? message : [message];
                this.log(level, ...message);
            };

            if (res instanceof Promise) {
                res.then(_log)
                    .catch((e) => this.error("Error in lazy log", e))
                    .catch((e) => console.error("Error in lazy log", e));
            } else {
                _log(res);
            }
        } catch (e) {
            this.error("Error in lazy log", e);
        }
    }

    public debug(...message: any) {
        this.log(LogLevel.DEBUG, ...message);
    }

    public trace(...message: any) {
        this.log(LogLevel.TRACE, ...message);
    }

    public info(...message: any) {
        this.log(LogLevel.INFO, ...message);
    }

    public warn(...message: any) {
        this.log(LogLevel.WARN, ...message);
    }

    public error(...message: any) {
        this.log(LogLevel.ERROR, ...message);
    }

    public fatal(...message: any) {
        this.log(LogLevel.FATAL, ...message);
    }

    public debugLazy(func: () => any | Promise<any>) {
        this.logLazy(LogLevel.DEBUG, func);
    }

    public traceLazy(func: () => any | Promise<any>) {
        this.logLazy(LogLevel.TRACE, func);
    }

    public infoLazy(func: () => any | Promise<any>) {
        this.logLazy(LogLevel.INFO, func);
    }

    public warnLazy(func: () => any | Promise<any>) {
        this.logLazy(LogLevel.WARN, func);
    }

    public errorLazy(func: () => any | Promise<any>) {
        this.logLazy(LogLevel.ERROR, func);
    }

    public fatalLazy(func: () => any | Promise<any>) {
        this.logLazy(LogLevel.FATAL, func);
    }
}

let globalLoggerTags: { [key: string]: string } = {};
let globalLoggerConfig: { [key: string]: any } = {};

if (typeof window !== "undefined") {
    globalLoggerTags = (window as any)?.globalLoggerTags as any;
    globalLoggerConfig = (window as any)?.globalLoggerConfig as any;
    if (!globalLoggerTags) {
        (window as any).globalLoggerTags = globalLoggerTags = {};
    }
    if (!globalLoggerConfig) {
        (window as any).globalLoggerConfig = globalLoggerConfig = {};
    }
}

if (typeof global !== "undefined") {
    globalLoggerTags = (global as any)?.globalLoggerTags as any;
    if (!globalLoggerTags) {
        (global as any).globalLoggerTags = globalLoggerTags = {};
    }
    globalLoggerConfig = (global as any)?.globalLoggerConfig as any;
    if (!globalLoggerConfig) {
        (global as any).globalLoggerConfig = globalLoggerConfig = {};
    }
}

export function setGlobalLoggerTag(key: string, value: string) {
    if (value === undefined || value === null) {
        delete globalLoggerTags[key];
    } else {
        globalLoggerTags[key] = value;
    }
}

export function setGlobalLoggerConfig(key: string, value: any) {
    if (value === undefined || value === null) {
        delete globalLoggerConfig[key];
    } else {
        globalLoggerConfig[key] = value;
    }
}

export function getLogger(name: string = "default", tags: string[] = [], level?: string): Logger {
    let httpEndpoint = "";
    let env = "production";
    let authKey = "";

    // load environment variables when possible
    try {
        if (typeof process.env.NODE_ENV !== "undefined") {
            env = process.env.NODE_ENV || env;
        }
    } catch (e) {
        console.log(e);
    }

    try {
        if (typeof process.env.LOGPIPE_ENDPOINT !== "undefined") {
            httpEndpoint = process.env.LOGPIPE_ENDPOINT + "/write" || httpEndpoint;
        }
    } catch (e) {
        console.log(e);
    }

    try {
        if (typeof process.env.LOG_LEVEL !== "undefined") {
            level = level ?? process.env.LOG_LEVEL;
        }
    } catch (e) {
        console.log(e);
    }

    try {
        if (typeof process.env.LOGPIPE_AUTHKEY !== "undefined") {
            authKey = process.env.LOGPIPE_AUTHKEY;
        }
    } catch (e) {
        console.log(e);
    }

    httpEndpoint = globalLoggerConfig?.endpoint ?? httpEndpoint;
    authKey = globalLoggerConfig?.authKey ?? authKey;
    env = globalLoggerConfig?.env ?? env;
    level = globalLoggerConfig?.level ?? level;
    level = level ?? (env === "development" ? "TRACE" : "INFO");

    if (!isBrowser) {
        tags.push("backend");
    } else {
        tags.push("frontend");
    }

    const logger = new Logger(name, LogLevel[level as keyof typeof LogLevel], tags, globalLoggerTags);

    if (globalLoggerConfig?.attachments) {
        for (const attachment of globalLoggerConfig.attachments) {
            logger.addAttachment(attachment);
        }
    } else {
        if (env === "development") {
            logger.addAttachment(new ConsoleLogAttachment());
            if (httpEndpoint) logger.addAttachment(new JSONLogAttachment(httpEndpoint, authKey));
        } else {
            logger.addAttachment(new ConsoleLogAttachment());
        }
    }
    return logger;
}
