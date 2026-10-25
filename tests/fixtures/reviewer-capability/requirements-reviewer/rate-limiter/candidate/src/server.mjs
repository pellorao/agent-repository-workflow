import {createServer} from 'node:http';

export const createAppServer = ({handle, limiter, clientIdOf = request => request.socket.remoteAddress}) => createServer((request, response) => {
    const decision = limiter.check(clientIdOf(request));
    if (!decision.allowed) {
        response.writeHead(429, {'retry-after': String(Math.floor(decision.retryAfterMs / 1000))});
        response.end('Too many requests');
        return;
    }
    const body = handle(request);
    response.writeHead(200, {'content-type': 'text/plain'});
    response.end(body);
});
