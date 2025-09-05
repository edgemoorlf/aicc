package com.demo.chatbot.interfaces.request;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
public abstract class BaseRequest {
    /**
     * 请求ID
     */
    @NotEmpty
    private String requestId;
    /**
     * 租户ID, 即阿里云主账号
     */
    @NotNull
    private Long tenantId;
    /**
     * 云联络中心实例ID
     */
    @NotEmpty
    private String instanceId;
    /**
     * 数字员工场景ID
     */
    @NotEmpty
    private String scriptId;
    /**
     * 会话ID
     */
    @NotEmpty
    private String sessionId;
    /**
     * 对话轮次ID
     */
    @NotEmpty
    private String streamId;
}
