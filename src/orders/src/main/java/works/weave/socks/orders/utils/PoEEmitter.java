package works.weave.socks.orders.utils;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
// no spooling/retry per user request

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.*;

@Component
public class PoEEmitter {
    private static final Logger LOG = LoggerFactory.getLogger(PoEEmitter.class);

    @Value("${poe.sidecar.url:${POE_SIDECAR_URL:http://orders-poe-sidecar:8089/prove}}")
    private String sidecarUrl;

    @Value("${poe.service.name:orders}")
    private String serviceName;

    @Value("${poe.service.namespace:#{null}}")
    private String serviceNamespace;

    @Value("${poe.pod.name:#{null}}")
    private String podName;

    @Value("${poe.pod.uid:#{null}}")
    private String podUid;

    @Value("${poe.image.digest:#{null}}")
    private String imageDigest;

    @Value("${poe.code.version:#{null}}")
    private String codeVersion;

    @Value("${poe.code.hash:#{null}}")
    private String codeHash;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final int connectTimeout = 2000; // 2 seconds
    private final int readTimeout = 0;       // fire-and-forget: do not wait for response

    // Shared scheduler for timeouts
    private static final ScheduledExecutorService scheduler =
            Executors.newScheduledThreadPool(1, r -> {
                Thread t = new Thread(r);
                t.setDaemon(true);
                t.setName("poe-timeout-scheduler");
                return t;
            });

    public void emitPoE(String reqId, Object input, Object output) {
        try {
            PoERequest request = new PoERequest();
            request.serviceName = serviceName;
            request.serviceNamespace = serviceNamespace;
            request.podName = podName;
            request.podUid = podUid;
            request.imageDigest = imageDigest;
            request.codeVersion = codeVersion;
            request.codeHash = codeHash;
            request.reqId = reqId;
            request.input = objectMapper.writeValueAsString(input);
            request.output = objectMapper.writeValueAsString(output);

            CompletableFuture<Void> task = CompletableFuture.runAsync(() -> {
                try {
                    String json = objectMapper.writeValueAsString(request);
                    postFireAndForget(json, reqId);

                } catch (Exception e) {
                    LOG.error("Failed to emit PoE for reqId: {} (continuing)", reqId, e);
                }
            });

            // Apply a manual timeout (Java 8 safe)
            withTimeout(task, 3, TimeUnit.SECONDS)
                    .exceptionally(throwable -> {
                        LOG.warn("PoE emission async task timed out for reqId: {}", reqId);
                        return null;
                    });

        } catch (Exception e) {
            LOG.error("Failed to create PoE request for reqId: {}", reqId, e);
        }
    }

    private void postFireAndForget(String json, String reqId) throws Exception {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(sidecarUrl);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Connection", "close");
            conn.setConnectTimeout(connectTimeout);
            // no read timeout: we won't read a response
            conn.setDoOutput(true);
            byte[] payload = json.getBytes(StandardCharsets.UTF_8);
            conn.setFixedLengthStreamingMode(payload.length);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(payload);
                os.flush();
            }
            LOG.info("PoE sent (fire-and-forget) for reqId: {}", reqId);
        } finally {
            if (conn != null) {
                try { conn.disconnect(); } catch (Exception ignore) {}
            }
        }
    }
    // Removed spooling/retry per user request

    // Java 8 compatible timeout helper
    private static <T> CompletableFuture<T> withTimeout(
            CompletableFuture<T> future, long timeout, TimeUnit unit) {

        final CompletableFuture<T> result = new CompletableFuture<>();

        final ScheduledFuture<?> timeoutTask = scheduler.schedule(() -> {
            result.completeExceptionally(new TimeoutException("Timeout after " + timeout + " " + unit));
        }, timeout, unit);

        future.whenComplete((value, ex) -> {
            if (ex != null) {
                result.completeExceptionally(ex);
            } else {
                result.complete(value);
            }
            timeoutTask.cancel(true);
        });

        return result;
    }

    public static class PoERequest {
        public String serviceName;
        public String serviceNamespace;
        public String podName;
        public String podUid;
        public String imageDigest;
        public String codeVersion;
        public String codeHash;
        public String reqId;
        public String input;
        public String output;
    }
}
