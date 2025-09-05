package com.demo.chatbot.interfaces;

public interface SseCallback<T> {
    void onResponse(T response);
}