package com.demo.chatbot.bvt;

public interface InvokeStreamFcCallback {
    void setFirstResponseDuration(long duration);
    void onData(InvokeStreamFcResult result);
    void onComplete();
}
