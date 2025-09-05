package com.demo.chatbot.interfaces.response;

import lombok.Data;

@Data
public class BaseResponse {
    private String code = "OK";
    private String message = "Success";
    private String requestId;
    private Integer httpStatusCode = 200;
    private boolean success = true;
}