const http = require('http');
const https = require('https');

class PoEEmitter {
    constructor() {
        this.sidecarUrl = process.env.POE_SIDECAR_URL || 'http://127.0.0.1:8089/prove';
        this.serviceName = process.env.POE_SERVICE_NAME || 'frontend';
        this.serviceNamespace = process.env.POE_SERVICE_NAMESPACE || null;
        this.podName = process.env.POE_POD_NAME || null;
        this.podUid = process.env.POE_POD_UID || null;
        this.imageDigest = process.env.POE_IMAGE_DIGEST || null;
        this.codeVersion = process.env.POE_CODE_VERSION || null;
        this.codeHash = process.env.POE_CODE_HASH || null;
    }

    emitPoE(reqId, input, output) {
        const payload = {
            service_name: this.serviceName,
            service_namespace: this.serviceNamespace,
            pod_name: this.podName,
            pod_uid: this.podUid,
            image_digest: this.imageDigest,
            code_version: this.codeVersion,
            code_hash: this.codeHash,
            req_id: reqId,
            input: JSON.stringify(input),
            output: JSON.stringify(output)
        };

        const postData = JSON.stringify(payload);
        const url = new URL(this.sidecarUrl);
        const options = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            },
            timeout: 2000
        };

        const client = url.protocol === 'https:' ? https : http;
        const req = client.request(options, (res) => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                console.log(`PoE emitted successfully for reqId: ${reqId}`);
            } else {
                console.warn(`PoE emission failed with status ${res.statusCode} for reqId: ${reqId}`);
            }
        });

        req.on('error', (err) => {
            console.error(`Failed to emit PoE for reqId: ${reqId}`, err);
        });

        req.on('timeout', () => {
            console.error(`PoE emission timeout for reqId: ${reqId}`);
            req.destroy();
        });

        req.write(postData);
        req.end();
    }
}

module.exports = new PoEEmitter();
