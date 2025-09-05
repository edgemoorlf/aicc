package com.demo.chatbot.interfaces.request;

import jakarta.validation.constraints.NotNull;
import lombok.Data;
import lombok.EqualsAndHashCode;

import java.util.List;
import java.util.Map;

@EqualsAndHashCode(callSuper = true)
@Data
public class DialogueRequest extends BaseRequest {
    /**
     * 用户发言
     */
    @NotNull
    private String utterance;
    /**
     * 扩展内容
     *
     * @see com.demo.chatbot.interfaces.constant.ExtraDataType
     * @see com.demo.chatbot.interfaces.constant.ExtraDtmfParam
     */
    private List<Map<String, String>> extras;

}
