package com.demo.chatbot.interfaces.response;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotEmpty;
import lombok.Data;

import java.util.List;

@Data
public class BaseResponse {
    @NotEmpty
    private String requestId;

    @Max(600)
    @Min(200)
    private int httpStatusCode;
    @NotEmpty
    private String code;
    private String message;
    private List<String> params;

    public BaseResponse() {
        this.httpStatusCode = 200;
        this.code = "OK";
    }

    public BaseResponse(int httpStatusCode, String code, String message, List<String> params) {
        this.httpStatusCode = httpStatusCode;
        this.code = code;
        this.message = message;
        this.params = params;
    }

    public boolean isSuccess() {
        return "OK".equals(this.code);
    }
}
