import {createServer} from 'node:http';

export const createAppServer = ({handle}) => createServer((request, response) => {
    const body = handle(request);
    response.writeHead(200, {'content-type': 'text/plain'});
    response.end(body);
});
