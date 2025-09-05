package com.demo.chatbot.interfaces.constant;

public enum ControlType {
    /**
     * 挂断
     */
    HangUp,
    /**
     * 转接
     */
    Transfer,
    /**
     * 获取按键
     */
    GatherDtmf,
    /**
     * 语音控制参数
     */
    Voice,
    /**
     * 发送短信，暂不支持后期支持
     */
    SendSms;
}
