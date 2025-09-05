package com.demo.chatbot.interfaces.dto;

import lombok.Builder;
import lombok.Data;

@Builder
@Data
public class DtmfControlParams {
    private int maxDigits = 11;
    private int timeout = 10;
    private String type = "GatherDtmf";
}