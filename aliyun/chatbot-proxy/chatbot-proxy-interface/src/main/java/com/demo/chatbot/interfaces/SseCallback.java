package com.demo.chatbot.interfaces;

import com.demo.chatbot.interfaces.response.BaseResponse;

public interface SseCallback<T extends BaseResponse> {
    void onResponse(T response);
}
