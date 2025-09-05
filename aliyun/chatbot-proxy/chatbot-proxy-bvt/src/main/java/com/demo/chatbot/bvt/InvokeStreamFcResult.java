package com.demo.chatbot.bvt;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

@Builder
@Data
@NoArgsConstructor
@AllArgsConstructor
public class InvokeStreamFcResult {
    private int httpStatusCode;
    private Map<String,String> headers;
    private String httpBody;
    private String errorMessage;
}
