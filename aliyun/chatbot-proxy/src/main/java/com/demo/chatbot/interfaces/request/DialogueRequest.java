package com.demo.chatbot.interfaces.request;

import jakarta.validation.constraints.NotNull;
import lombok.Data;
import lombok.EqualsAndHashCode;

import java.util.List;
import java.util.Map;

@EqualsAndHashCode(callSuper = true)
@Data
public class DialogueRequest extends BaseRequest {
    @NotNull
    private String utterance;
    private List<Map<String, String>> extras;
}