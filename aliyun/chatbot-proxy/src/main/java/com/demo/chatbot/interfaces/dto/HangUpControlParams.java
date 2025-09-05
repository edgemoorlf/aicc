package com.demo.chatbot.interfaces.dto;

import lombok.Builder;
import lombok.Data;

@Builder
@Data
public class HangUpControlParams {
    private int delay = 5;
    private String reason = "user_requested";
    private String type = "HangUp";
}