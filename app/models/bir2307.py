from typing import List, Optional, Union

from pydantic import BaseModel, Field


class DataField(BaseModel):
    """
    A generic field to hold a value and its type.
    """

    value: Optional[Union[str, float]] = Field(
        None, description="The value of the field"
    )
    type: str = Field(
        ..., description="Data type of the value (e.g., 'string', 'number')"
    )


class GovernmentInformation(BaseModel):
    country: DataField = Field(..., description="Country information")
    department: DataField = Field(..., description="Department information")
    agency: DataField = Field(..., description="Agency information")


class BIRForm(BaseModel):
    formNumber: DataField = Field(..., description="BIR form number")
    version: DataField = Field(..., description="BIR form version")


class Certificate(BaseModel):
    title: DataField = Field(..., description="Certificate title")
    code: DataField = Field(..., description="Certificate code")


class Period(BaseModel):
    from_: DataField = Field(..., description="Start period")
    to: DataField = Field(..., description="End period")
    format: DataField = Field(..., description="Date format (MM/DD/YY)")


class PayeeInformation(BaseModel):
    TIN: DataField = Field(..., description="Taxpayer Identification Number")
    name: DataField = Field(..., description="Payee's name")
    registeredAddress: DataField = Field(..., description="Registered address")
    ZIP: DataField = Field(..., description="ZIP code")
    foreignAddress: DataField = Field(
        ..., description="Foreign address (if applicable)"
    )


class PayorInformation(BaseModel):
    TIN: DataField = Field(..., description="Taxpayer Identification Number")
    name: DataField = Field(..., description="Payor's name")
    registeredAddress: DataField = Field(..., description="Registered address")
    ZIP: DataField = Field(..., description="ZIP code")


class IncomePayment(BaseModel):
    description: DataField = Field(..., description="Description of the income payment")
    ATC: DataField = Field(..., description="ATC code")
    firstMonth: Optional[DataField] = Field(None, description="Amount for 1st month")
    secondMonth: Optional[DataField] = Field(None, description="Amount for 2nd month")
    thirdMonth: Optional[DataField] = Field(None, description="Amount for 3rd month")
    total: Optional[DataField] = Field(None, description="Total amount")
    taxWithheld: Optional[DataField] = Field(
        None, description="Tax withheld for the quarter"
    )


class Bir2307(BaseModel):
    """
    A Pydantic model representing the BIR 2307 form.
    """

    pageHeader: DataField = Field(..., description="Page header")
    governmentInformation: GovernmentInformation = Field(
        ..., description="Government information"
    )
    birForm: BIRForm = Field(..., description="BIR form details")
    certificate: Certificate = Field(..., description="Certificate details")
    period: Period = Field(..., description="Period details")
    payeeInformation: PayeeInformation = Field(..., description="Payee information")
    payorInformation: PayorInformation = Field(..., description="Payor information")
    incomePayments: Optional[List[IncomePayment]] = Field(
        ..., description="List of income payment details"
    )
    declaration: DataField = Field(..., description="Declaration text")
    payorSignature: DataField = Field(..., description="Payor's signature")
    payeeSignature: DataField = Field(..., description="Payee's signature")
    hasPayorSignature: DataField = Field(..., description="Has payor signature")
    isPayorSignatureValid: DataField = Field(
        ..., description="Is payor signature valid"
    )
    isPayorsNameInSignatureUppercase: DataField = Field(
        ..., description="Is payor's name in signature uppercase"
    )
    dateOfIssuance: DataField = Field(..., description="Date of issuance")
    dateOfExpiry: DataField = Field(..., description="Date of expiry")
    note: DataField = Field(..., description="Additional note")
