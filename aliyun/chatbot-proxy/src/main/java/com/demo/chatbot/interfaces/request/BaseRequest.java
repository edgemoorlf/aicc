package com.demo.chatbot.interfaces.request;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
public abstract class BaseRequest {
    @NotEmpty
    private String requestId;
    @NotNull
    private Long tenantId;
    @NotEmpty
    private String instanceId;
    @NotEmpty
    private String scriptId;
    @NotEmpty
    private String sessionId;
    @NotEmpty
    private String streamId;
}