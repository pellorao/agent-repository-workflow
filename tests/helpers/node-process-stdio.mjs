import {createReadStream, writeSync} from 'node:fs';
import {Readable, Writable} from 'node:stream';

const useOrdinaryInputDescriptor = () => {
    const stream = process.stdin;
    if (stream.constructor.name !== Readable.name || stream.fd !== 0) return;
    Object.defineProperty(process, 'stdin', {
        configurable: true,
        value: createReadStream('', {autoClose: false, fd: 0}),
    });
};

const useOrdinaryFileDescriptor = (/** @type {NodeJS.WriteStream & {fd?: number}} */ stream, /** @type {number} */ fileDescriptor) => {
    if (stream.constructor.name !== Writable.name || stream.fd !== fileDescriptor) return;
    const ordinaryWrite = (
        /** @type {string | Uint8Array} */ chunk,
        /** @type {BufferEncoding | ((error?: Error | null) => void)} */ encoding = 'utf8',
        /** @type {((error?: Error | null) => void) | undefined} */ callback = undefined,
    ) => {
        const completed = typeof encoding === 'function' ? encoding : callback;
        const bytes = typeof chunk === 'string'
            ? Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8')
            : chunk;
        try {
            writeSync(fileDescriptor, bytes);
            completed?.();
            return true;
        } catch (error) {
            if (completed === undefined) throw error;
            completed(error instanceof Error ? error : new Error(String(error)));
            return false;
        }
    };
    Object.defineProperty(stream, 'write', {configurable: true, value: ordinaryWrite, writable: true});
};

useOrdinaryInputDescriptor();
useOrdinaryFileDescriptor(process.stdout, 1);
useOrdinaryFileDescriptor(process.stderr, 2);
