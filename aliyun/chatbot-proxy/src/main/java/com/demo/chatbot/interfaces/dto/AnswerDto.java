package com.demo.chatbot.interfaces.dto;

import lombok.Builder;
import lombok.Data;

import java.util.List;

@Builder
@Data
public class AnswerDto {
    @Builder.Default
    private boolean streamEnd = false;
    private long updatedTime;
    private String sessionId;
    private String streamId;
    private String answer;
    private List<String> controlParamsList;
}