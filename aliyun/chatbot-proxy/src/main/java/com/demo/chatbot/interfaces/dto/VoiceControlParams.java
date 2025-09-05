package com.demo.chatbot.interfaces.dto;

import lombok.Builder;
import lombok.Data;

@Builder
@Data
public class VoiceControlParams {
    private boolean interruptible = true;
    private int silenceDetectionTimeout = 5;
    private String type = "Voice";
}