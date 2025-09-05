package com.demo.chatbot.interfaces.constant;

import lombok.Getter;

@Getter
public enum ExtraDtmfParam {
    DTMF("dtmf");

    private final String filed;

    ExtraDtmfParam(String filed) {
        this.filed = filed;
    }
}
