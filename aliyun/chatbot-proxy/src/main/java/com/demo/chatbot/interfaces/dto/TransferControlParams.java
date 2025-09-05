package com.demo.chatbot.interfaces.dto;

import lombok.Builder;
import lombok.Data;

@Builder
@Data
public class TransferControlParams {
    private String transferType;
    private String transferee;
    private String type = "Transfer";
}