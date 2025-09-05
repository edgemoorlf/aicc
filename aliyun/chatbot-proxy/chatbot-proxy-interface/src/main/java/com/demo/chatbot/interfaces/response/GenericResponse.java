package com.demo.chatbot.interfaces.response;

import lombok.Data;
import lombok.EqualsAndHashCode;

@EqualsAndHashCode(callSuper = true)
@Data
public class GenericResponse<T> extends BaseResponse {
    private T data;
}
