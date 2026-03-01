import json
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
    dateOfIssuance: DataField = Field(..., description="Date of issuance")
    dateOfExpiry: DataField = Field(..., description="Date of expiry")
    note: DataField = Field(..., description="Additional note")

    @staticmethod
    def example():
        """
        Returns an example Bir2307 object with sample values.
        """
        return Bir2307(
            pageHeader=DataField(value="TS-WF-205F-0012327", type="string"),
            governmentInformation=GovernmentInformation(
                country=DataField(value="Republic of the Philippines", type="string"),
                department=DataField(value="Department of Finance", type="string"),
                agency=DataField(value="Bureau of Internal Revenue", type="string"),
            ),
            birForm=BIRForm(
                formNumber=DataField(value="2307", type="string"),
                version=DataField(value="January 2018 (ENCS)", type="string"),
            ),
            certificate=Certificate(
                title=DataField(
                    value="Certificate of Creditable Tax Withheld At Source",
                    type="string",
                ),
                code=DataField(value="2307 01/18ENCS", type="string"),
            ),
            period=Period(
                **{"from": DataField(value="07012023", type="string")},
                to=DataField(value="09302023", type="string"),
                format=DataField(value="MM/DD/YY", type="string"),
            ),
            payeeInformation=PayeeInformation(
                TIN=DataField(value="267-090-070-00000", type="string"),
                name=DataField(value="THERMA MARINE, INC.", type="string"),
                registeredAddress=DataField(
                    value="MOBILE 2, LAWIS, SANTA ANA, AGUSAN DEL NORTE PHILIPPINES 8602 PHILIPPINES",
                    type="string",
                ),
                ZIP=DataField(value="8602", type="string"),
                foreignAddress=DataField(value="", type="string"),
            ),
            payorInformation=PayorInformation(
                TIN=DataField(value="008-657-558-0000", type="string"),
                name=DataField(value="ANGAT HYDROPOWER CORPORATION", type="string"),
                registeredAddress=DataField(
                    value="ANGAT HYDROELECTRIC POWER PLANT SAN LORENZO, NORZAGARAY, BULACAN",
                    type="string",
                ),
                ZIP=DataField(value="3013", type="string"),
            ),
            incomePayments=[
                IncomePayment(
                    description=DataField(
                        value="EWT- Income payments made by top 10,000 private corporations to their local/resident supplier of services",
                        type="string",
                    ),
                    ATC=DataField(value="WC 160", type="string"),
                    firstMonth=DataField(value="", type="string"),
                    secondMonth=DataField(value=1.22, type="number"),
                    thirdMonth=DataField(value="", type="string"),
                    total=DataField(value=1.22, type="number"),
                    taxWithheld=DataField(value=0.02, type="number"),
                ),
                IncomePayment(
                    description=DataField(value="Total", type="string"),
                    ATC=DataField(value="", type="string"),
                    firstMonth=DataField(value="", type="string"),
                    secondMonth=DataField(value=1.22, type="number"),
                    thirdMonth=DataField(value="", type="string"),
                    total=DataField(value=1.22, type="number"),
                    taxWithheld=DataField(value=0.02, type="number"),
                ),
                IncomePayment(
                    description=DataField(
                        value="Money Payments Subject to Withholding of Business Tax (Government & Private)",
                        type="string",
                    ),
                    ATC=DataField(value="", type="string"),
                    firstMonth=DataField(value="", type="string"),
                    secondMonth=DataField(value="", type="string"),
                    thirdMonth=DataField(value="", type="string"),
                    total=DataField(value="", type="string"),
                    taxWithheld=DataField(value="", type="string"),
                ),
                IncomePayment(
                    description=DataField(value="Total", type="string"),
                    ATC=DataField(value="", type="string"),
                    firstMonth=DataField(value="", type="string"),
                    secondMonth=DataField(value="", type="string"),
                    thirdMonth=DataField(value="", type="string"),
                    total=DataField(value="", type="string"),
                    taxWithheld=DataField(value="", type="string"),
                ),
            ],
            declaration=DataField(
                value=(
                    "We declare under the penalties of perjury that this certificate has been made in good faith, verified by us, and to the best "
                    "of our knowledge and belief, is true and correct, pursuant to the provisions of the National Internal Revenue Code, as amended, "
                    "and the regulations issued under authority thereof. Further, we give our consent to the processing of our information as contemplated "
                    "under the Data Privacy Act of 2012 (R.A. No. 10173) for legitimate and lawful purposes."
                ),
                type="string",
            ),
            payorSignature=DataField(
                value="PABLITO A. PAMANTANG, JR. / FINANCE MANAGER / 198-656-147-000",
                type="string",
            ),
            payeeSignature=DataField(value="", type="string"),
            dateOfIssuance=DataField(value="", type="string"),
            dateOfExpiry=DataField(value="", type="string"),
            note=DataField(
                value="NOTE: The BIR Data Privacy is in the BIR website (www.bir.gov.ph)",
                type="string",
            ),
        )

    @staticmethod
    def from_json(json_str: str):
        """
        Converts a JSON string to a Bir2307 object.
        """
        data = json.loads(json_str)
        return Bir2307.parse_obj(data)
