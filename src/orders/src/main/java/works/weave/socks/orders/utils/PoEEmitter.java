package works.weave.socks.orders.utils;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

@Component
public class PoEEmitter {
    private static final Logger LOG = LoggerFactory.getLogger(PoEEmitter.class);
    
    @Value("${poe.sidecar.url:http://127.0.0.1:8089/prove}")
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
    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(2))
            .build();
    
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
            
            // Send asynchronously to avoid blocking
            CompletableFuture.runAsync(() -> {
                try {
                    String json = objectMapper.writeValueAsString(request);
                    HttpRequest httpRequest = HttpRequest.newBuilder()
                            .uri(URI.create(sidecarUrl))
                            .header("Content-Type", "application/json")
                            .POST(HttpRequest.BodyPublishers.ofString(json))
                            .timeout(Duration.ofSeconds(2))
                            .build();
                    
                    HttpResponse<String> response = httpClient.send(httpRequest, 
                            HttpResponse.BodyHandlers.ofString());
                    
                    if (response.statusCode() >= 200 && response.statusCode() < 300) {
                        LOG.debug("PoE emitted successfully for reqId: {}", reqId);
                    } else {
                        LOG.warn("PoE emission failed with status {}: {}", 
                                response.statusCode(), response.body());
                    }
                } catch (Exception e) {
                    LOG.error("Failed to emit PoE for reqId: {}", reqId, e);
                }
            });
        } catch (Exception e) {
            LOG.error("Failed to create PoE request for reqId: {}", reqId, e);
        }
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
