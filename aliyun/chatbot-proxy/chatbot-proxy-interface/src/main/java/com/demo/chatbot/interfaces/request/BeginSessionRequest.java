package com.demo.chatbot.interfaces.request;

import jakarta.validation.constraints.NotNull;
import lombok.Data;
import lombok.EqualsAndHashCode;

import java.util.Map;

@EqualsAndHashCode(callSuper = true)
@Data
public class BeginSessionRequest extends BaseRequest {
    /**
     * 随路参数
     *
     * @see com.demo.chatbot.interfaces.constant.VendorParamConstant
     */
    @NotNull
    private Map<String, String> vendorParams;
}
