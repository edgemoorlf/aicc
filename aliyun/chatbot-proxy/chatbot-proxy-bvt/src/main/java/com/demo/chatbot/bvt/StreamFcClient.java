package com.demo.chatbot.bvt;

import com.alibaba.fastjson2.JSON;
import com.aliyun.openapiutil.Client;
import com.aliyun.tea.TeaRequest;
import lombok.Builder;
import lombok.extern.slf4j.Slf4j;
import okhttp3.*;
import okhttp3.internal.sse.RealEventSource;
import okhttp3.sse.EventSource;
import okhttp3.sse.EventSourceListener;
import org.apache.commons.lang3.StringUtils;
import org.apache.commons.lang3.tuple.Pair;
import org.apache.hc.core5.http.NameValuePair;
import org.apache.hc.core5.net.URLEncodedUtils;
import org.slf4j.MDC;

import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

@Builder
@Slf4j
public class StreamFcClient {
    private OkHttpClient client;
    private StreamFcClientConfig config;
    private String httpTriggerUrl;

    public void invokeFunction(String requestId, String path, String requestBody, InvokeStreamFcCallback callback) throws Exception {
        String method = "POST";
        String url = StringUtils.isNotEmpty(path) ? (this.httpTriggerUrl + path) : this.httpTriggerUrl;

        String date = Instant.now().toString();

        Pair<String, String> authorization = this.getAuthorization(url, method, date);

        log.info("Authorization is {}.", JSON.toJSONString(authorization));
        Request httpRequest = new Request.Builder()
                .url(url)
                .addHeader("Accept", "text/event-stream")
                .addHeader("x-acs-date", date)
                .addHeader("x-acs-security-token", authorization.getLeft())
                .addHeader("authorization", authorization.getRight())
                .post(RequestBody.create(requestBody, MediaType.get("application/json")))
                .build();

        long startTime = System.currentTimeMillis();
        RealEventSource eventStream = new RealEventSource(httpRequest, new EventSourceListener() {
            private volatile boolean receivedFirstResponse = false;

            @Override
            public void onOpen(EventSource eventSource, Response response) {
                try {
                    MDC.put("REQ_ID", requestId);
                    log.info("Connection {} is opened.", url);
                } finally {
                    MDC.remove("REQ_ID");
                }
            }


            @Override
            public void onEvent(EventSource eventSource, String id, String type, String data) {
                try {
                    MDC.put("REQ_ID", requestId);
                    log.info("Connection {} receive data is {}.", url, data);
                    if (!receivedFirstResponse) {
                        this.receivedFirstResponse = true;
                        callback.setFirstResponseDuration(System.currentTimeMillis() - startTime);
                    }
                    InvokeStreamFcResult result = InvokeStreamFcResult.builder()
                            .httpStatusCode(200)
                            .httpBody(data)
                            .build();
                    callback.onData(result);
                } finally {
                    MDC.remove("REQ_ID");
                }
            }

            @Override
            public void onClosed(EventSource eventSource) {
                try {
                    MDC.put("REQ_ID", requestId);
                    log.info("Connection {} is closed.", url);
                    callback.onComplete();
                } finally {
                    MDC.remove("REQ_ID");
                }
            }

            @Override
            public void onFailure(EventSource eventSource, Throwable t, Response httpResponse) {
                try {
                    MDC.put("REQ_ID", requestId);
                    InvokeStreamFcResult result = InvokeStreamFcResult.builder()
                            .httpStatusCode(httpResponse.code())
                            .build();

                    Map<String, String> headers = new HashMap<>();
                    httpResponse.headers().names().forEach(x -> {
                        if (x.startsWith("x-fc")) {
                            headers.put(x, httpResponse.header(x));
                        }
                    });
                    result.setHeaders(headers);

                    if (t != null) {
                        result.setErrorMessage(t.getMessage());
                    } else {
                        result.setErrorMessage(httpResponse.message());
                    }

                    if (httpResponse.body() != null) {
                        try {
                            result.setHttpBody(httpResponse.body().string());
                        } catch (Exception ignore) {
                        }
                    }

                    callback.onData(result);
                } finally {
                    callback.onComplete();
                    MDC.remove("REQ_ID");
                }
            }
        });

        log.info("Invoke sse call {}, request is {}.", url, requestBody);
        eventStream.connect(this.client);
    }

    private Pair<String, String> getAuthorization(String url, String method, String date) throws Exception {
        URI uri = null;
        try {
            uri = new URI(url);
        } catch (URISyntaxException e) {
            throw new RuntimeException("Path or httpTriggerUrl format is invalid.");
        }
        TeaRequest req = new TeaRequest();
        req.method = method;
        req.pathname = uri.getPath();
        Map<String, String> query = new HashMap<String, String>();
        for (NameValuePair pair : URLEncodedUtils.parse(uri, StandardCharsets.UTF_8)) {
            query.put(pair.getName(), pair.getValue());
        }
        req.query = query;
        Map<String, String> headers = new HashMap<String, String>();
        headers.put("x-acs-date", date);
        headers.put("x-acs-security-token", config.getSecurityToken());
        req.headers = headers;
        return Pair.of(config.getSecurityToken(), Client.getAuthorization(req, "ACS3-HMAC-SHA256", "", config.getAccessKeyId(), config.getAccessKeySecret()));
    }
}
