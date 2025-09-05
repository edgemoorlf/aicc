package com.demo.chatbot.bvt;

import lombok.Builder;
import lombok.Data;

@Builder
@Data
public class StreamFcClientConfig {
    private String securityToken;
    private String accessKeyId;
    private String accessKeySecret;
}
